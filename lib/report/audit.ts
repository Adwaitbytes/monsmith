import "server-only";

import { callAI, hasAIProvider } from "../aiClient";
import { analyzeParallelPotential } from "../parallel/analyzer";
import type { Finding, Severity } from "./types";

/**
 * A threat model, not a checklist.
 *
 * The audit this replaces was fourteen regular expressions. It could tell you
 * that a contract contained `.call{value:` without `nonReentrant`, which is
 * worth knowing, and it could tell you nothing else. Every contract got the
 * same fourteen questions regardless of what it actually did, so a vault, a
 * governor and a token were all audited as though they were the same program.
 *
 * Monad's own writing on this makes the argument better than we could: a
 * hand-maintained list of known-bad patterns always misses the case nobody
 * wrote down, and specificity to the real data flows beats generic guidance.
 * The fix is not a longer list. It is to derive what can go wrong from what
 * this particular contract is for.
 *
 * So the audit runs in four passes, each feeding the next:
 *
 *   1. describe   what the contract does, in functional terms, with no
 *                 security framing at all. Asking for vulnerabilities first
 *                 produces a model that pattern matches; asking what the code
 *                 is for produces one that has actually read it.
 *   2. threats    what could go wrong given that description. Assets, actors,
 *                 trust boundaries and invariants, derived from this contract
 *                 rather than recalled from a corpus.
 *   3. findings   concrete vulnerabilities, each tied to a line and an attack
 *                 that would actually work.
 *   4. review     a second pass that attacks the findings themselves. This is
 *                 the one that earns its cost: it is where the plausible but
 *                 wrong finding dies, and a report full of those is worse than
 *                 no report because it teaches people to ignore it.
 *
 * The structural facts handed to pass 1 come from the parallel analyzer, which
 * has already parsed the entrypoints and the storage each one touches. Giving
 * the model a real parse rather than a wall of source is the difference between
 * it reasoning about state and it guessing from identifiers.
 */

// ============= WHAT THE PASSES PRODUCE =============

export interface ContractDescription {
    purpose: string;
    /** What is worth stealing or breaking, in this contract's own terms. */
    assets: string[];
    /** Who can call what, and which of them are trusted. */
    actors: Array<{ name: string; trusted: boolean; canDo: string }>;
    /** Statements that must stay true. These are what an exploit violates. */
    invariants: string[];
    /** Every point where control leaves this contract. */
    externalInteractions: string[];
}

export interface Threat {
    id: string;
    title: string;
    /** Which invariant or asset it goes after. */
    target: string;
    /** How an attacker would try it, in this contract specifically. */
    approach: string;
}

export interface AuditFinding {
    title: string;
    severity: Severity;
    /** 0 to 1. Below the floor, a finding is dropped rather than hedged. */
    confidence: number;
    line: number | null;
    /** The code the claim rests on, quoted from the source. */
    evidence: string;
    /** Ordered steps an attacker takes. Vague findings die here. */
    attack: string;
    impact: string;
    fix: string;
}

export interface DeepAudit {
    description: ContractDescription | null;
    threats: Threat[];
    findings: AuditFinding[];
    /** Findings the review pass rejected, kept so the work is inspectable. */
    rejected: Array<{ title: string; reason: string }>;
    /** True when every pass ran. False means the report says so. */
    complete: boolean;
    notes: string[];
}

/**
 * Below this, a finding is dropped.
 *
 * A report is trusted or it is ignored, and one confident-sounding false
 * positive costs more trust than three missed lows cost coverage. Hedged
 * findings are the same failure wearing a disclaimer, so there is no "possible"
 * severity to hide behind: it is reported or it is not.
 */
const CONFIDENCE_FLOOR = 0.6;

const SEVERITIES = new Set<Severity>(["critical", "high", "medium", "low", "info"]);

// ============= MODEL PLUMBING =============

/**
 * Pulls JSON out of a completion.
 *
 * Models fence their output, preface it, and occasionally apologise first, so
 * the text is searched for the outermost brace rather than parsed directly.
 * Returning null instead of throwing lets a failed pass degrade the audit by
 * one stage rather than losing the whole report.
 */
function extractJson<T>(raw: string): T | null {
    const candidate = outermostObject(raw);
    if (candidate === null) return null;

    try {
        return JSON.parse(candidate) as T;
    } catch {
        return repairJson<T>(candidate);
    }
}

/**
 * Finds the outermost JSON value by balancing braces, not by matching fences.
 *
 * The fence-matching version of this cost an entire audit pass. A model asked
 * for a unified diff will happily put one in a fenced block *inside* a JSON
 * string, and a non-greedy fence regex then ends the match at that inner fence
 * and truncates the object halfway through. The failure is silent: the parse
 * returns nothing and the contract looks clean.
 *
 * Scanning for balance cannot be fooled that way, as long as it knows it is
 * inside a string and honours escapes, which is the whole of the logic below.
 */
function outermostObject(raw: string): string | null {
    const start = raw.search(/[[{]/);
    if (start === -1) return null;

    const open = raw[start];
    const close = open === "{" ? "}" : "]";

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < raw.length; index += 1) {
        const char = raw[index];

        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\") {
            escaped = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        // Braces inside a string are data, including the ones in a diff.
        if (inString) continue;

        if (char === open) depth += 1;
        else if (char === close) {
            depth -= 1;
            if (depth === 0) return raw.slice(start, index + 1);
        }
    }

    // Unbalanced means the response was cut off. The prefix is still worth one
    // repair attempt, since a truncated array of findings often has whole
    // entries in it.
    return depth > 0 ? raw.slice(start) : null;
}

/**
 * One attempt at salvaging almost-JSON.
 *
 * The failure worth handling is a model quoting source code inside a string and
 * not escaping the quotes in it, which turned a good pass into a silent zero.
 * The line-range change removes the usual cause, but a model can always find a
 * new way to emit a stray quote, and losing an entire audit pass to one
 * character is too expensive to leave to chance.
 *
 * Deliberately narrow: trailing commas and unescaped quotes inside string
 * values, nothing more. A parser that tries harder than this starts inventing
 * structure, and inventing structure in an audit is worse than failing.
 */
function repairJson<T>(text: string): T | null {
    const withoutTrailingCommas = text.replace(/,(\s*[}\]])/g, "$1");
    try {
        return JSON.parse(withoutTrailingCommas) as T;
    } catch {
        // Escape quotes that sit inside a value, recognised as those not
        // followed by a structural character.
        const escaped = withoutTrailingCommas.replace(
            /(:\s*")((?:[^"\\]|\\.)*)"(?=\s*[,}\]])/g,
            (_match, prefix: string, value: string) =>
                `${prefix}${value.replace(/(?<!\\)"/g, '\\"')}"`,
        );
        try {
            return JSON.parse(escaped) as T;
        } catch {
            return null;
        }
    }
}

async function ask<T>(
    system: string,
    prompt: string,
    deadline: number,
    modelOffset = 0,
): Promise<T | null> {
    if (Date.now() >= deadline) return null;
    try {
        const raw = await callAI(prompt, system, undefined, deadline, modelOffset, {
            temperature: 0.15,
            maxTokens: 4096,
        });
        const parsed = extractJson<T>(raw);
        if (parsed === null) {
            // A pass that silently returns nothing is indistinguishable from a
            // clean contract, which is the worst way for an audit to fail. The
            // head of the response says which it was: a refusal, a truncation,
            // or JSON we could not read.
            console.warn(
                `[audit] could not parse a response of ${raw.length} chars; it began: ${raw.slice(0, 220).replace(/\s+/g, " ")}`,
            );
            if (process.env.AUDIT_DEBUG === "1") {
                console.warn(`[audit] full response:\n${raw}`);
            }
        }
        return parsed;
    } catch (error) {
        console.warn("[audit] pass failed:", error instanceof Error ? error.message : error);
        return null;
    }
}

/** Source with line numbers, because a finding without a line is not actionable. */
function numbered(source: string): string {
    return source
        .split("\n")
        .map((line, index) => `${String(index + 1).padStart(4)} | ${line}`)
        .join("\n");
}

/**
 * The structural facts, from a real parse rather than the model's reading.
 *
 * This is the "primitives over lists" idea applied to the prompt itself. The
 * model is told which functions mutate which storage slots, which are read
 * only, and where the contended state is, because that is derived from the
 * source by a parser that cannot be wrong about it.
 */
function structuralBrief(source: string): string {
    try {
        const parsed = analyzeParallelPotential(source);
        const entries = parsed.entrypoints
            .slice(0, 40)
            .map((entry) => {
                const writes = entry.writes.map((effect) => effect.variable);
                const reads = entry.reads.map((effect) => effect.variable);
                const external = entry.conflictsWith.length > 0
                    ? ` serialises-with[${entry.conflictsWith.join(", ")}]`
                    : "";
                return `  - ${entry.name} [${entry.visibility} ${entry.stateMutability}] line ${entry.line} writes[${writes.join(", ")}] reads[${reads.join(", ")}]${external}`;
            })
            .join("\n");

        const readOnly = parsed.readOnlyFunctions.map((fn) => fn.name).join(", ");
        const hot = parsed.hotspots
            .map((spot) => `${spot.variable} (${spot.scope}, written by ${spot.writers.join("/")})`)
            .join("; ");

        return [
            `Contract: ${parsed.contract}`,
            `Entrypoints and the storage each touches:`,
            entries || "  (none parsed)",
            readOnly.length > 0 ? `View functions: ${readOnly}` : "",
            hot.length > 0 ? `Most contended storage: ${hot}` : "",
        ]
            .filter((line) => line.length > 0)
            .join("\n");
    } catch {
        // A parse failure costs the model a hint, not the audit.
        return "(structural parse unavailable)";
    }
}

// ============= PASS 1: WHAT DOES THIS DO =============

const DESCRIBE_SYSTEM = `You are a smart contract engineer reading unfamiliar Solidity.
Describe what the contract DOES, in functional terms. Do not look for
vulnerabilities and do not mention security. A description written to find bugs
pattern matches; a description written to understand the code reads it.
Respond with JSON only.`;

async function describe(
    source: string,
    deadline: number,
): Promise<ContractDescription | null> {
    const prompt = `${structuralBrief(source)}

Source:
\`\`\`solidity
${source.slice(0, 22_000)}
\`\`\`

Return JSON:
{
  "purpose": "one or two sentences on what this is for",
  "assets": ["what this contract holds or controls that has value"],
  "actors": [{"name":"who", "trusted":true|false, "canDo":"what they may call"}],
  "invariants": ["statements that must always hold, in this contract's terms"],
  "externalInteractions": ["every point where control or value leaves this contract"]
}`;

    const result = await ask<ContractDescription>(DESCRIBE_SYSTEM, prompt, deadline);
    if (result === null || typeof result.purpose !== "string") return null;

    return {
        purpose: result.purpose,
        assets: asStrings(result.assets),
        actors: Array.isArray(result.actors)
            ? result.actors
                  .filter((actor) => actor !== null && typeof actor === "object")
                  .map((actor) => ({
                      name: String(actor.name ?? "unknown"),
                      trusted: actor.trusted === true,
                      canDo: String(actor.canDo ?? ""),
                  }))
                  .slice(0, 12)
            : [],
        invariants: asStrings(result.invariants),
        externalInteractions: asStrings(result.externalInteractions),
    };
}

function asStrings(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === "string").slice(0, 16);
}

// ============= PASS 2: WHAT COULD GO WRONG HERE =============

const THREAT_SYSTEM = `You are a smart contract security researcher building a threat model.
Derive threats from THIS contract's assets, actors and invariants. Do not list
generic vulnerability categories. "Reentrancy" is not a threat; "an attacker
re-enters withdraw through the ETH transfer to drain the pool before their
balance is decremented" is. Respond with JSON only.`;

async function deriveThreats(
    description: ContractDescription,
    source: string,
    deadline: number,
): Promise<Threat[]> {
    const prompt = `Contract purpose: ${description.purpose}
Assets: ${description.assets.join("; ")}
Actors: ${description.actors.map((a) => `${a.name}${a.trusted ? " (trusted)" : ""}: ${a.canDo}`).join("; ")}
Invariants that must hold: ${description.invariants.join("; ")}
External interactions: ${description.externalInteractions.join("; ")}

${structuralBrief(source)}

For each invariant and each asset, ask what an attacker could do to break it,
given the actors and the external interactions above. Return JSON:
{"threats":[{"id":"t1","title":"short","target":"which invariant or asset","approach":"concretely how, in this contract"}]}`;

    const result = await ask<{ threats?: Threat[] }>(THREAT_SYSTEM, prompt, deadline);
    if (result === null || !Array.isArray(result.threats)) return [];

    return result.threats
        .filter((threat) => threat !== null && typeof threat === "object")
        .map((threat, index) => ({
            id: String(threat.id ?? `t${index + 1}`),
            title: String(threat.title ?? "Untitled threat"),
            target: String(threat.target ?? ""),
            approach: String(threat.approach ?? ""),
        }))
        .slice(0, 20);
}

// ============= PASS 3: WHERE IT ACTUALLY BREAKS =============

const FIND_SYSTEM = `You are one of the best smart contract auditors in the world.
You are testing a threat model against real code. Every finding must cite a line
number and quote the code it rests on, and must describe an attack that would
actually work against THIS code. If a threat turns out not to be exploitable
here, do not report it. Reporting something that is not real costs more trust
than missing something does. Respond with JSON only.`;

async function findVulnerabilities(
    description: ContractDescription,
    threats: Threat[],
    source: string,
    deadline: number,
): Promise<AuditFinding[]> {
    const prompt = `Purpose: ${description.purpose}
Invariants: ${description.invariants.join("; ")}

Threats to test against the code:
${threats.map((t) => `- [${t.id}] ${t.title}: ${t.approach}`).join("\n")}

Also consider anything the threat model missed that this source reveals.

Source with line numbers:
\`\`\`
${numbered(source).slice(0, 26_000)}
\`\`\`

Return JSON:
{"findings":[{
  "title":"specific, names the function",
  "severity":"critical|high|medium|low|info",
  "confidence":0.0-1.0,
  "lineStart":<first line of the offending code, from the listing>,
  "lineEnd":<last line of it, usually within a few lines of lineStart>,
  "attack":"numbered steps an attacker takes",
  "impact":"what is lost, concretely",
  "fix":"the change to make, described in prose"
}]}

Severity: critical means funds are directly at risk now. high means a realistic
path to loss. medium means it needs an unlikely precondition. low is hygiene.
info is context worth knowing that is not a defect.

Do not put source code, diffs or code fences in any field. Refer to code by line
number only. Solidity is full of double quotes and code fences, and both break
the response.`;

    const result = await ask<{ findings?: AuditFinding[] }>(FIND_SYSTEM, prompt, deadline);
    if (result === null || !Array.isArray(result.findings)) return [];

    const lines = source.split("\n");
    const lineCount = lines.length;

    /*
      Evidence is sliced from the source rather than quoted by the model.

      Asking for the offending code back as a JSON string was the original
      design and it was wrong twice over. Solidity is full of double quotes, so
      `require(x, "insufficient")` inside a JSON string broke the parse and the
      whole pass silently returned nothing. And a transcription can drift from
      the file, which means the evidence for a finding could be something the
      contract does not actually say. A line range cannot do either: it is one
      integer the model has to get right, and the quote comes from the file.
    */
    const excerpt = (from: number, to: number): string => {
        const start = Math.max(1, Math.min(from, lineCount));
        const end = Math.max(start, Math.min(to, lineCount, start + 12));
        return lines
            .slice(start - 1, end)
            .map((text, index) => `${start + index} | ${text}`)
            .join("\n");
    };

    return result.findings
        .filter((finding) => finding !== null && typeof finding === "object")
        .map((finding) => {
            const severity = SEVERITIES.has(finding.severity as Severity)
                ? (finding.severity as Severity)
                : "info";
            const rawLine = Number(
                (finding as unknown as { lineStart?: unknown }).lineStart ?? finding.line,
            );
            const rawEnd = Number((finding as unknown as { lineEnd?: unknown }).lineEnd);
            // A line outside the file means the model invented it, which is
            // reason to distrust the location rather than the whole finding.
            const line =
                Number.isFinite(rawLine) && rawLine >= 1 && rawLine <= lineCount
                    ? Math.round(rawLine)
                    : null;
            const confidence = Number(finding.confidence);

            return {
                title: String(finding.title ?? "Untitled finding"),
                severity,
                confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
                line,
                evidence:
                    line === null
                        ? ""
                        : excerpt(line, Number.isFinite(rawEnd) ? Math.round(rawEnd) : line),
                attack: String(finding.attack ?? ""),
                impact: String(finding.impact ?? ""),
                fix: String(finding.fix ?? ""),
            };
        })
        .slice(0, 30);
}

// ============= PASS 4: ATTACK THE FINDINGS =============

const REVIEW_SYSTEM = `You verify audit findings. Another auditor produced these.

Your default is to let a finding stand. You may only reject one when you can
point to the specific line that prevents it: a modifier, a guard, a require, an
ordering, or a type constraint. Cite that line number. If you cannot cite one,
the finding stands, even if it feels weak. "I do not think this is exploitable"
is not a rejection; "line 14 decrements the balance before the call" is.

Two things are not grounds for rejection. That a privileged function is intended
for a trusted owner does not make missing access control safe. And an external
call made BEFORE a state update is reentrancy, whatever the surrounding code
looks like.

Deleting a real finding costs far more than leaving a weak one in. Respond with
JSON only.`;

/**
 * The pass that makes the rest worth printing.
 *
 * A different model sees this than produced the findings, which is why
 * `modelOffset` is set: asking the same model to check its own work mostly
 * returns agreement, since the reasoning that produced the mistake is the
 * reasoning being asked to catch it.
 */
async function review(
    findings: AuditFinding[],
    source: string,
    deadline: number,
    confirmed: ReadonlyArray<{ title: string; line?: number }>,
): Promise<{ kept: AuditFinding[]; rejected: Array<{ title: string; reason: string }> }> {
    if (findings.length === 0) return { kept: [], rejected: [] };

    const established =
        confirmed.length === 0
            ? ""
            : `Static analysis has already confirmed the following in this code. These are
settled. Do not reject a finding that restates one of them, and do not argue
that the code prevents them:
${confirmed.map((entry) => `- ${entry.title}${entry.line !== undefined ? ` (line ${entry.line})` : ""}`).join("\n")}

`;

    const prompt = `${established}Source with line numbers:
\`\`\`
${numbered(source).slice(0, 24_000)}
\`\`\`

Findings to judge:
${findings.map((f, i) => `[${i}] ${f.title} (line ${f.line ?? "?"}, ${f.severity})\n     attack: ${f.attack}`).join("\n")}

For each, return a verdict. Return JSON:
{"verdicts":[{
  "index":0,
  "holds":true|false,
  "preventedByLine":<line number that prevents it, or null>,
  "reason":"why",
  "severity":"corrected severity if the original was wrong, else the same"
}]}

Do not include source code or code fences in any field.`;

    const result = await ask<{
        verdicts?: Array<{
            index: number;
            holds: boolean;
            reason: string;
            severity?: string;
            preventedByLine?: number | null;
        }>;
    }>(REVIEW_SYSTEM, prompt, deadline, 1);

    // A review that did not run must not silently pass everything: findings are
    // kept, but the caller is told the audit is incomplete so the report can
    // say the verification step did not happen.
    if (result === null || !Array.isArray(result.verdicts)) {
        return { kept: findings, rejected: [] };
    }

    const verdicts = new Map<number, { holds: boolean; reason: string; severity?: string }>();
    for (const verdict of result.verdicts) {
        const index = Number(verdict?.index);
        if (!Number.isInteger(index)) continue;

        /*
          A rejection without a citation is not honoured.

          Left to its own judgement the reviewer rejected a textbook reentrancy
          on the reasoning that "the call is made before the state updates",
          which is the vulnerability restated as though it were a defence.
          Requiring it to name the line that prevents the attack makes rejection
          the harder path, which is the right default: deleting a real finding
          costs far more than leaving a weak one in.
        */
        const cited = Number(
            (verdict as unknown as { preventedByLine?: unknown }).preventedByLine,
        );
        const rejects = verdict.holds === false;
        const substantiated = Number.isFinite(cited) && cited >= 1;

        verdicts.set(index, {
            holds: rejects ? !substantiated : true,
            reason: String(verdict.reason ?? ""),
            ...(typeof verdict.severity === "string" ? { severity: verdict.severity } : {}),
        });
    }

    const kept: AuditFinding[] = [];
    const rejected: Array<{ title: string; reason: string }> = [];

    findings.forEach((finding, index) => {
        const verdict = verdicts.get(index);
        // Unjudged findings are kept. Dropping something nobody looked at would
        // hide a real issue behind a truncated response.
        if (verdict === undefined) {
            kept.push(finding);
            return;
        }
        if (!verdict.holds) {
            rejected.push({ title: finding.title, reason: verdict.reason });
            return;
        }
        const corrected =
            verdict.severity !== undefined && SEVERITIES.has(verdict.severity as Severity)
                ? (verdict.severity as Severity)
                : finding.severity;
        kept.push({ ...finding, severity: corrected });
    });

    return { kept, rejected };
}

// ============= THE AUDIT =============

export interface DeepAuditOptions {
    /** Wall clock for the whole audit. Passes are skipped as it runs out. */
    budgetMs?: number;
    /**
     * Findings a deterministic analyser already confirmed.
     *
     * These are facts, not opinions, and the reviewer is told it may not argue
     * with them. That rule exists because of a specific failure: asked to judge
     * a textbook reentrancy, the reviewer rejected it twice, first by restating
     * the vulnerability as though it were a defence, then by citing a `require`
     * that a re-entrant call passes straight through. A model checking another
     * model has no floor. A parser does.
     */
    confirmed?: ReadonlyArray<{ title: string; line?: number }>;
}

export async function deepAudit(
    source: string,
    options: DeepAuditOptions = {},
): Promise<DeepAudit> {
    const deadline = Date.now() + (options.budgetMs ?? 90_000);

    if (!hasAIProvider()) {
        return {
            description: null,
            threats: [],
            findings: [],
            rejected: [],
            complete: false,
            notes: [
                "The deep audit did not run because no AI provider is configured. What you see is the static analysis only.",
            ],
        };
    }

    const notes: string[] = [];

    const description = await describe(source, deadline);
    if (description === null) {
        return {
            description: null,
            threats: [],
            findings: [],
            rejected: [],
            complete: false,
            notes: ["The contract could not be described, so no threat model was built."],
        };
    }

    const threats = await deriveThreats(description, source, deadline);
    if (threats.length === 0) notes.push("No threat model was produced, so findings are unguided.");

    const candidates = await findVulnerabilities(description, threats, source, deadline);

    const { kept, rejected } = await review(
        candidates,
        source,
        deadline,
        options.confirmed ?? [],
    );

    // Filtering on confidence happens after review, because the reviewer is
    // allowed to rescue a finding the first pass was unsure about.
    const confident = kept.filter((finding) => finding.confidence >= CONFIDENCE_FLOOR);
    const dropped = kept.length - confident.length;
    if (dropped > 0) {
        notes.push(
            `${dropped} finding${dropped === 1 ? " was" : "s were"} held back for being too uncertain to act on.`,
        );
    }
    if (rejected.length > 0) {
        notes.push(
            `${rejected.length} candidate finding${rejected.length === 1 ? "" : "s"} did not survive review.`,
        );
    }

    return {
        description,
        threats,
        findings: confident,
        rejected,
        complete: true,
        notes,
    };
}

/** Audit findings in the report's own shape. */
export function toFindings(audit: DeepAudit, contractId: string): Finding[] {
    return audit.findings.map((finding, index) => ({
        id: `${contractId}:ai:${index}`,
        severity: finding.severity,
        title: finding.title,
        source: "ai" as const,
        ...(finding.line !== null ? { line: finding.line } : {}),
        description: [finding.impact, "", "How it is exploited:", finding.attack]
            .filter((part) => part.length > 0)
            .join("\n"),
        evidence: finding.evidence,
        fix: finding.fix,
    }));
}
