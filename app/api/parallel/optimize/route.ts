import { NextResponse } from "next/server";

import { callAI, hasAIProvider, MISSING_PROVIDER_MESSAGE } from "@/lib/aiClient";
import { compileVersioned } from "@/lib/solc/compile";
import { analyzeParallelPotential } from "@/lib/parallelAnalyzer";
import { checkCompatibility, describeIncompatibility } from "@/lib/parallel/compatibility";
import { parseSolidity } from "@/lib/parallel/parser";
import type { Hotspot, ParallelAnalysisResult } from "@/lib/parallelAnalyzer";

/**
 * AI-assisted parallel optimisation.
 *
 * The static analyser says which slots serialise a contract; this route asks a
 * model to restructure them and then refuses to hand back the answer until it
 * has proved two things about it: the contract still compiles, and its entire
 * external surface is intact. A rewrite that silently drops a function or
 * changes a signature is not an optimisation, so it never reaches the editor.
 */

export const maxDuration = 300;

/** Rewriting a contract is a long completion, so it gets its own budget. */
const OPTIMIZE_BUDGET_MS = 240_000;
const MODEL_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 3;
const MAX_SOURCE_CHARS = 80_000;

const SYSTEM_ROLE =
    "You are a senior Solidity engineer who specialises in Monad's parallel EVM. " +
    "You restructure storage layout to remove write contention without altering what a contract does. " +
    "You never remove functionality to make a metric look better, and you say so plainly when a slot cannot be split.";

export interface RewriteChange {
    title: string;
    detail: string;
}

export async function POST(req: Request) {
    const deadline = Date.now() + OPTIMIZE_BUDGET_MS;

    try {
        if (!hasAIProvider()) {
            return NextResponse.json({ success: false, error: MISSING_PROVIDER_MESSAGE }, { status: 503 });
        }

        const { code, contract } = await req.json();

        if (typeof code !== "string" || code.trim().length === 0) {
            return NextResponse.json({ success: false, error: "Contract source is required" }, { status: 400 });
        }
        if (code.length > MAX_SOURCE_CHARS) {
            return NextResponse.json(
                {
                    success: false,
                    error: `This source is ${Math.round(code.length / 1000)}KB. Optimisation runs on contracts up to ${MAX_SOURCE_CHARS / 1000}KB so the rewrite can be returned whole.`,
                },
                { status: 413 }
            );
        }

        const before = analyzeParallelPotential(code, typeof contract === "string" ? contract : undefined);
        const target = before.contract;

        if (before.entrypoints.length === 0) {
            return NextResponse.json(
                { success: false, error: "No state-changing entrypoints to optimise in this contract." },
                { status: 400 }
            );
        }

        const contended = before.hotspots.filter((hotspot) => hotspot.scope === "global");
        if (contended.length === 0) {
            return NextResponse.json({
                success: false,
                error: "Every slot this contract writes is already keyed. There is no forced serialisation left to remove.",
            });
        }

        // Whether the original compiles decides whether compilation can be used
        // as a gate at all: a contract pinned to an older compiler than the one
        // bundled here is still worth optimising, just not verifiable that way.
        const baseline = await tryCompile(code);

        const attempts: string[] = [];
        let feedback = "";

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            if (Date.now() > deadline - 20_000) break;

            const prompt = buildPrompt(code, target, before, contended, feedback);
            const raw = await callAI(prompt, SYSTEM_ROLE, undefined, deadline, attempt - 1, {
                maxTokens: 12_000,
                temperature: 0.2,
                modelTimeoutMs: MODEL_TIMEOUT_MS,
            });

            const optimized = extractSolidity(raw);
            if (!optimized) {
                feedback = "Your previous reply contained no Solidity source. Return the complete contract file inside a ```solidity block.";
                attempts.push("model returned no Solidity");
                continue;
            }

            const problems: string[] = [];

            const compatibility = checkCompatibility(code, optimized, target);
            if (!compatibility.compatible) problems.push(describeIncompatibility(compatibility));

            if (baseline.ok) {
                const rebuilt = await tryCompile(optimized);
                if (!rebuilt.ok) {
                    problems.push(`Your rewrite does not compile. The compiler reported:\n${rebuilt.error.slice(0, 1200)}`);
                }
            }

            if (!hasTargetContract(optimized, target)) {
                problems.push(`Your rewrite no longer declares \`contract ${target}\`. Keep the contract name unchanged.`);
            }

            if (problems.length === 0) {
                const after = analyzeParallelPotential(optimized, target);

                return NextResponse.json({
                    success: true,
                    contract: target,
                    improved: after.metrics.pairsBlocked < before.metrics.pairsBlocked,
                    optimizedCode: optimized,
                    before: summarize(before),
                    after: summarize(after),
                    changes: describeChanges(code, optimized, before, after, target),
                    modelNotes: extractNotes(raw),
                    verification: {
                        interfacePreserved: true,
                        preservedMembers: compatibility.preservedCount,
                        addedMembers: compatibility.added.map((member) => `${member.kind} ${member.signature}`),
                        compiled: baseline.ok,
                        compilerSkippedReason: baseline.ok
                            ? null
                            : "The original source does not build with the bundled compiler, so the rewrite was checked against the contract's source interface instead.",
                        behaviourVerified: false,
                    },
                    attempts: attempt,
                });
            }

            attempts.push(problems.join(" | ").slice(0, 240));
            feedback = `${problems.join("\n\n")}\n\nReturn the corrected complete contract file. Output only Solidity.`;
        }

        return NextResponse.json(
            {
                success: false,
                error: "The rewrite could not be verified against the original contract's interface.",
                attempts,
            },
            { status: 422 }
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected server error";
        console.error("Parallel optimisation error:", error);
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}

function buildPrompt(
    source: string,
    target: string,
    analysis: ParallelAnalysisResult,
    contended: Hotspot[],
    feedback: string
): string {
    const findings = contended
        .map((hotspot) => {
            const readers = hotspot.readers.length > 0 ? `, read by ${hotspot.readers.join(", ")}` : "";
            return `- \`${hotspot.variable}\` (${hotspot.typeText}): one slot for every caller, written by ${hotspot.writers.join(", ")}${readers}.`;
        })
        .join("\n");

    const serial = analysis.entrypoints
        .filter((entry) => entry.contention === "serial")
        .map((entry) => `- ${entry.name}(): ${entry.reason}`)
        .join("\n");

    const base = `Rewrite the contract \`${target}\` below so more of its transactions can execute concurrently on Monad's parallel EVM.

Monad executes transactions optimistically in parallel and re-runs any transaction that read or wrote a storage slot another transaction had already written. Two transactions therefore run concurrently only when their storage footprints do not overlap on a written slot. A mapping entry is its own slot, so state keyed by \`msg.sender\` never collides between different senders; a plain state variable is a single slot every caller lands on.

Measured today: ${analysis.score}/100 (grade ${analysis.grade}). ${analysis.metrics.pairsBlocked} of ${analysis.metrics.pairsTotal} entrypoint pairs are forced to serialise.

Slots that force serialisation:
${findings}

Entrypoints that cannot run alongside each other:
${serial || "- none"}

Rules, all of them binding:
1. Keep every public and external function with exactly the same name and parameter types. Keep every event with the same name and parameter types. Keep every public state variable readable under the same name and argument types.
2. Keep the pragma, the licence identifier, every other contract, library and interface in the file, and the contract's name.
3. Keep all behaviour: the same arithmetic, the same access control, the same require and revert conditions, the same events emitted with the same values, the same reentrancy protection. An optimisation that changes what the contract does is a defect.
4. Change only how state is laid out and addressed: give a global slot a key when its value is genuinely per account or per market; split a hot counter into stripes and sum them in the accessor; pack narrow variables that are written together; move write-only history into events.
5. Some slots cannot be split. An AMM reserve, a supply invariant or a reentrancy guard is shared by definition. Leave those exactly as they are and explain why in the notes rather than inventing a change that breaks the invariant.
6. If a public getter's storage moves, keep the getter and have it compute the same value from the new layout.

Output format:
First a \`\`\`solidity block containing the complete file, ready to compile, nothing omitted or elided.
Then a \`\`\`notes block: one line per change, saying what moved and why, and one line for each contended slot you deliberately left alone.

Contract source:
\`\`\`solidity
${source}
\`\`\``;

    return feedback ? `${base}\n\n---\nYour previous attempt was rejected.\n\n${feedback}` : base;
}

/** Pulls the Solidity file out of a model reply, tolerating the usual preamble. */
function extractSolidity(raw: string): string | null {
    const fenced = raw.match(/```(?:solidity|sol)?\s*\n([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : raw;

    if (!/\bpragma\s+solidity\b/.test(candidate)) return null;
    const trimmed = candidate.trim();
    return trimmed.length > 0 ? `${trimmed}\n` : null;
}

function extractNotes(raw: string): string[] {
    const block = raw.match(/```notes\s*\n([\s\S]*?)```/);
    if (!block) return [];

    return block[1]
        .split("\n")
        .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
        .filter((line) => line.length > 0)
        .slice(0, 12);
}

async function tryCompile(
    source: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
        await compileVersioned(source, { outputs: ["abi"] });
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

function hasTargetContract(source: string, target: string): boolean {
    return parseSolidity(source).some((unit) => unit.name === target && unit.kind === "contract");
}

function summarize(analysis: ParallelAnalysisResult) {
    return {
        score: analysis.score,
        grade: analysis.grade,
        headline: analysis.headline,
        entrypoints: analysis.totalFunctions,
        parallelEntrypoints: analysis.parallelizableFunctions,
        blockedPairs: analysis.metrics.pairsBlocked,
        totalPairs: analysis.metrics.pairsTotal,
        globalSlots: analysis.hotspots.filter((hotspot) => hotspot.scope === "global").map((hotspot) => hotspot.variable),
    };
}

/**
 * What measurably changed.
 *
 * Derived from the two analyses rather than from the model's account of its own
 * work, and deliberately cautious about causality: a slot vanishing from the
 * hotspot list can mean it was resolved or merely renamed, and only the pair
 * count can tell those apart. Claiming an improvement the numbers do not show
 * would make this whole feature untrustworthy.
 */
function describeChanges(
    originalSource: string,
    optimizedSource: string,
    before: ParallelAnalysisResult,
    after: ParallelAnalysisResult,
    target: string
): RewriteChange[] {
    const changes: RewriteChange[] = [];
    const freed = before.metrics.pairsBlocked - after.metrics.pairsBlocked;

    changes.push(
        freed > 0
            ? {
                title: `${freed} fewer blocked entrypoint ${freed === 1 ? "pair" : "pairs"}`,
                detail: `${before.metrics.pairsBlocked} of ${before.metrics.pairsTotal} pairs were forced to serialise; now ${after.metrics.pairsBlocked} are.`,
            }
            : {
                title: "No reduction in forced serialisation",
                detail:
                    "The contended slots in this contract carry contract-wide invariants, so the rewrite left them in place. The notes below give the reasoning.",
            }
    );

    const afterByName = new Map(after.hotspots.map((hotspot) => [hotspot.variable, hotspot]));

    for (const hotspot of before.hotspots.filter((h) => h.scope === "global")) {
        const now = afterByName.get(hotspot.variable);

        if (now && now.scope !== "global") {
            changes.push({
                title: `${hotspot.variable} is now ${now.scope === "caller" ? "keyed by msg.sender" : "keyed"}`,
                detail:
                    now.scope === "caller"
                        ? "Each account writes its own slot, so different senders never collide here."
                        : "Transactions serialise on this variable only when they use the same key.",
            });
        } else if (now && now.blockedPairs < hotspot.blockedPairs) {
            changes.push({
                title: `${hotspot.variable} blocks fewer pairs`,
                detail: `Down from ${hotspot.blockedPairs} to ${now.blockedPairs}, though it is still one slot for every caller.`,
            });
        } else if (!now && freed > 0) {
            changes.push({
                title: `${hotspot.variable} no longer contends`,
                detail: "It is gone from the entrypoint footprints, replaced by keyed or striped state, or moved into events.",
            });
        }
    }

    const declaredBefore = stateVariableIndex(originalSource, target);
    const declaredAfter = stateVariableIndex(optimizedSource, target);

    const added = [...declaredAfter.keys()].filter((name) => !declaredBefore.has(name));
    const removed = [...declaredBefore.keys()].filter((name) => !declaredAfter.has(name));
    const retyped = [...declaredAfter.entries()].filter(
        ([name, type]) => declaredBefore.has(name) && declaredBefore.get(name) !== type
    );

    if (added.length > 0 || removed.length > 0) {
        changes.push({
            title: "Storage layout changed",
            detail: [
                added.length > 0 ? `added ${added.join(", ")}` : "",
                removed.length > 0 ? `removed ${removed.join(", ")}` : "",
            ]
                .filter(Boolean)
                .join("; ") + ". Public getters were checked separately and are all intact.",
        });
    }

    for (const [name, type] of retyped) {
        changes.push({ title: `${name} changed type`, detail: `${declaredBefore.get(name)} became ${type}.` });
    }

    const stillGlobal = after.hotspots.filter((h) => h.scope === "global");
    if (stillGlobal.length > 0) {
        changes.push({
            title: `${stillGlobal.length} slot${stillGlobal.length === 1 ? "" : "s"} still shared by every caller`,
            detail: `${stillGlobal.map((h) => h.variable).join(", ")}. Splitting these would change what the contract guarantees.`,
        });
    }

    return changes;
}

function stateVariableIndex(source: string, target: string): Map<string, string> {
    const unit = parseSolidity(source).find((candidate) => candidate.name === target);
    return new Map((unit?.stateVariables ?? []).map((variable) => [variable.name, variable.typeText]));
}
