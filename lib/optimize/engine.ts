/**
 * The optimizer's pure parts: what the model is asked, and how its answer is
 * turned into a new contract.
 *
 * The model returns edits, not a file. Each edit quotes the exact text it
 * replaces, and an edit only applies if that text occurs exactly once. Three
 * things follow from that, and they are the reason for the design:
 *
 * - Everything the model did not choose to change is byte-for-byte the
 *   original, so a rewrite cannot quietly drop a function it never mentioned.
 * - The output is small, so even a 900-line pool is optimized inside the time
 *   a request has, where regenerating the whole file would not be.
 * - Every edit names the findings it fixes and says why, which is the list of
 *   changes the reader sees next to the diff.
 *
 * Nothing here decides whether an edit is good. That is decided downstream by
 * compiling the result, checking its external interface is intact, and running
 * the full report on it again.
 */

import type { Finding, Severity } from '../report/types';

export interface Edit {
    title: string;
    /** Finding ids this edit addresses, as given to the model. */
    fixes: string[];
    find: string;
    replace: string;
    why: string;
}

export interface OptimizeContext {
    path: string;
    contractName: string;
    source: string;
    /** The compiler the contract is pinned to, which the edits must keep. */
    pragma: string | null;
    findings: readonly Finding[];
    /** Storage slots that serialise the contract on Monad, from the parallel analysis. */
    contendedSlots: readonly string[];
    /** The costliest functions, heaviest first, from the gas profile. */
    expensiveFunctions: ReadonlyArray<{ name: string; gas: number | null }>;
    /** Files this one imports, for reference only. */
    imports: ReadonlyArray<{ path: string; source: string }>;
    /** What was wrong with the previous attempt, when there was one. */
    feedback?: string;
}

const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const IMPORT_CONTEXT_CHARS = 24_000;

export const OPTIMIZER_SYSTEM_ROLE =
    'You are a principal smart contract security engineer and gas optimizer who has audited Uniswap, Compound and Aave, ' +
    "and who knows Monad's parallel EVM in depth. You fix real vulnerabilities with the smallest correct change, " +
    'you never change what a contract does for its users, and you never delete functionality to make a number look better. ' +
    'When a finding is a false positive you leave the code alone and say so.';

/** The pragma line, so the edits can be told not to move the compiler. */
export function pragmaOf(source: string): string | null {
    return /^\s*pragma\s+solidity\s+([^;]+);/m.exec(source)?.[1]?.trim() ?? null;
}

function findingLine(finding: Finding): string {
    const where = finding.line === undefined ? '' : ` (line ${finding.line})`;
    const detail = [finding.description, finding.fix === undefined ? undefined : `Suggested fix: ${finding.fix}`]
        .filter((part): part is string => part !== undefined && part.length > 0)
        .join(' ');
    return `- [${finding.id}] ${finding.severity.toUpperCase()}${where}: ${finding.title}${detail.length > 0 ? `. ${detail}` : ''}`;
}

/** Numbered, so the model can quote exact text and we can talk about lines. */
function numbered(source: string): string {
    return source
        .split('\n')
        .map((line, index) => `${String(index + 1).padStart(4, ' ')} | ${line}`)
        .join('\n');
}

export function buildOptimizePrompt(context: OptimizeContext): string {
    const findings = [...context.findings]
        .filter((finding) => finding.severity !== 'info' || finding.source === 'gas' || finding.source === 'parallel')
        .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

    let importBudget = IMPORT_CONTEXT_CHARS;
    const imports: string[] = [];
    for (const file of context.imports) {
        if (importBudget <= 0) break;
        const text = file.source.slice(0, importBudget);
        importBudget -= text.length;
        imports.push(`--- ${file.path} (read only) ---\n${text}`);
    }

    return [
        `Optimize the Solidity file ${context.path}, whose main contract is ${context.contractName}.`,
        '',
        'GOALS, in this order:',
        '1. Fix every real critical and high finding. Then medium. Apply checks-effects-interactions, add a reentrancy guard where value or tokens leave the contract, replace tx.origin authorization with msg.sender, validate inputs, bound loops over growing arrays (keep a running total instead of looping), and emit events for state changes.',
        '2. Cut gas without changing behavior: cache storage reads in memory, mark never-reassigned state constant or immutable, use custom errors where the pragma allows (0.8.4 and later), use unchecked increments in bounded loops where overflow is impossible, pack storage, avoid repeated external calls.',
        "3. Reduce contention on Monad's parallel EVM: prefer per-user mappings over single global counters where the semantics allow it, and avoid writing a shared slot on every call when it is not needed.",
        '',
        'HARD RULES:',
        `- Keep the pragma exactly as it is (${context.pragma ?? 'as written'}). The file must compile with the same compiler.`,
        '- Keep every public and external function, event, modifier and state variable a caller or integrator can see, with the same name, parameters, return types and payability. Adding a modifier or internal helper is fine; renaming or removing any of those is not.',
        '- Do not add imports of files that are not shown here. If you need a reentrancy guard, write a minimal one inside the file.',
        '- Do not change what users can do or what they receive. A fix that changes economics is not a fix.',
        '- Skip findings that are false positives, and do not touch code that is already correct.',
        '',
        'FINDINGS FROM THE AUDIT:',
        findings.length > 0 ? findings.map(findingLine).join('\n') : '- none reported',
        '',
        context.contendedSlots.length > 0
            ? `STORAGE THAT SERIALISES THE CONTRACT ON MONAD: ${context.contendedSlots.join(', ')}`
            : 'No globally contended storage was found.',
        context.expensiveFunctions.length > 0
            ? `COSTLIEST FUNCTIONS: ${context.expensiveFunctions
                  .slice(0, 8)
                  .map((fn) => `${fn.name} (${fn.gas === null ? 'unbounded' : `${fn.gas} gas`})`)
                  .join(', ')}`
            : '',
        '',
        `THE FILE (line numbers are for reference only and are not part of the source):`,
        numbered(context.source),
        '',
        imports.length > 0 ? `FILES IT IMPORTS, for reference:\n${imports.join('\n\n')}\n` : '',
        context.feedback === undefined ? '' : `YOUR PREVIOUS ATTEMPT WAS REJECTED:\n${context.feedback}\n`,
        'ANSWER FORMAT. Reply with one or more edits and nothing else, each in exactly this shape:',
        '<edit title="short title of the change" fixes="comma separated finding ids, or empty">',
        '<find>',
        'exact text copied from the file, without the line number prefix, long enough to occur only once',
        '</find>',
        '<replace>',
        'the new text',
        '</replace>',
        '<why>one or two plain sentences for the developer</why>',
        '</edit>',
        '',
        'Each <find> must match the current file exactly once, including whitespace. Edits apply in order, so a later edit must quote the text as it is after the earlier ones. Prefer a few well-scoped edits over many tiny ones.',
    ]
        .join('\n')
        // Optional parts render as empty strings; collapse the gaps they leave.
        .replace(/\n{3,}/g, '\n\n');
}

const EDIT = /<edit\b([^>]*)>([\s\S]*?)<\/edit>/g;

function attribute(attributes: string, name: string): string {
    const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(attributes);
    return match?.[1]?.trim() ?? '';
}

/** Content between a tag pair, without the single newline after the opener and before the closer. */
function tag(body: string, name: string): string | null {
    const match = new RegExp(`<${name}>\\n?([\\s\\S]*?)\\n?</${name}>`).exec(body);
    return match === null ? null : match[1];
}

export function parseEdits(raw: string): Edit[] {
    const edits: Edit[] = [];
    for (const match of raw.matchAll(EDIT)) {
        const body = match[2];
        const find = tag(body, 'find');
        const replace = tag(body, 'replace');
        if (find === null || replace === null || find.length === 0) continue;
        edits.push({
            title: attribute(match[1], 'title') || 'Change',
            fixes: attribute(match[1], 'fixes')
                .split(',')
                .map((id) => id.trim())
                .filter((id) => id.length > 0),
            find,
            replace,
            why: (tag(body, 'why') ?? '').trim(),
        });
    }
    return edits;
}

function occurrences(haystack: string, needle: string): number {
    let count = 0;
    let from = 0;
    for (;;) {
        const at = haystack.indexOf(needle, from);
        if (at === -1) return count;
        count += 1;
        from = at + needle.length;
    }
}

export interface ApplyResult {
    source: string;
    applied: Edit[];
    rejected: Array<{ edit: Edit; reason: string }>;
}

/** Drops the "  64 | " prefixes a model copies from the numbered listing, when every line has one. */
function withoutLineNumbers(text: string): string {
    const lines = text.split('\n');
    const prefixed = /^\s*\d+ \| ?/;
    const content = lines.filter((line) => line.trim().length > 0);
    if (content.length === 0 || !content.every((line) => prefixed.test(line))) return text;
    return lines.map((line) => line.replace(prefixed, '')).join('\n');
}

type Located = { start: number; end: number } | { failure: string };

/**
 * Where an edit's quoted text sits in the file, as a character span.
 *
 * Exact first. Failing that, line by line with indentation and trailing space
 * ignored, which is the usual way a model misquotes code it has read correctly.
 * Either way the match must be unique: tolerance about whitespace, never about
 * which lines are meant.
 */
function locate(current: string, find: string): Located {
    const count = occurrences(current, find);
    if (count === 1) {
        const start = current.indexOf(find);
        return { start, end: start + find.length };
    }
    if (count > 1) return { failure: `its <find> text occurs ${count} times, so it is ambiguous` };

    const wanted = withoutLineNumbers(find)
        .split('\n')
        .map((line) => line.trim());
    while (wanted.length > 0 && wanted[0] === '') wanted.shift();
    while (wanted.length > 0 && wanted[wanted.length - 1] === '') wanted.pop();
    if (wanted.length === 0) return { failure: 'its <find> text is empty' };

    const lines = current.split('\n');
    const trimmed = lines.map((line) => line.trim());
    const matches: number[] = [];
    for (let index = 0; index + wanted.length <= lines.length; index++) {
        let same = true;
        for (let offset = 0; offset < wanted.length; offset++) {
            if (trimmed[index + offset] !== wanted[offset]) {
                same = false;
                break;
            }
        }
        if (same) matches.push(index);
    }
    if (matches.length === 0) return { failure: 'its <find> text does not occur in the file' };
    if (matches.length > 1) return { failure: `its <find> text occurs ${matches.length} times, so it is ambiguous` };

    // Whole lines, so the replacement's own indentation stands.
    const first = matches[0];
    const start = lines.slice(0, first).reduce((sum, line) => sum + line.length + 1, 0);
    const end = start + lines.slice(first, first + wanted.length).join('\n').length;
    return { start, end };
}

/**
 * Applies edits in order. An edit whose text is missing or ambiguous is
 * rejected rather than guessed at: replacing the wrong occurrence of a line is
 * exactly the kind of silent change the whole design exists to prevent.
 */
export function applyEdits(source: string, edits: readonly Edit[]): ApplyResult {
    let current = source;
    const applied: Edit[] = [];
    const rejected: ApplyResult['rejected'] = [];

    for (const edit of edits) {
        if (edit.find === edit.replace) continue;
        const span = locate(current, edit.find);
        if ('failure' in span) {
            rejected.push({ edit, reason: span.failure });
            continue;
        }
        current = current.slice(0, span.start) + withoutLineNumbers(edit.replace) + current.slice(span.end);
        applied.push(edit);
    }

    return { source: current, applied, rejected };
}

export function describeRejections(rejected: ApplyResult['rejected']): string {
    return rejected
        .map(({ edit, reason }) => `- The edit "${edit.title}" was not applied because ${reason}. It began: ${edit.find.slice(0, 120).replace(/\n/g, ' ')}`)
        .join('\n');
}

export interface LineDiff {
    added: number;
    removed: number;
    /** 1-indexed lines of `after` that are not in `before`. */
    changed: number[];
}

/** Lines added and removed, by a longest-common-subsequence over lines. */
export function lineDelta(before: string, after: string): { added: number; removed: number } {
    const { added, removed } = diffLines(before, after);
    return { added, removed };
}

/**
 * The line-level diff, including which lines of the new file are new.
 *
 * The fix review needs the changed lines to know where a fresh finding can
 * honestly be blamed on the optimizer.
 */
export function diffLines(before: string, after: string): LineDiff {
    const a = before.split('\n');
    const b = after.split('\n');
    // Trim the shared head and tail first; edits are local, so this leaves the
    // quadratic part tiny even for a large file.
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA -= 1;
        endB -= 1;
    }
    const x = a.slice(start, endA);
    const y = b.slice(start, endB);
    const middle = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => from + index + 1);
    if (x.length * y.length > 1_000_000) {
        return { added: y.length, removed: x.length, changed: middle(start, endB) };
    }

    // Full table, since the backtrack needs it to say which new lines are new.
    const table: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
    for (let i = 1; i <= x.length; i++) {
        for (let j = 1; j <= y.length; j++) {
            table[i][j] = x[i - 1] === y[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);
        }
    }

    const kept = new Set<number>();
    let i = x.length;
    let j = y.length;
    while (i > 0 && j > 0) {
        if (x[i - 1] === y[j - 1]) {
            kept.add(j - 1);
            i -= 1;
            j -= 1;
        } else if (table[i - 1][j] >= table[i][j - 1]) {
            i -= 1;
        } else {
            j -= 1;
        }
    }

    const common = table[x.length][y.length];
    const changed: number[] = [];
    for (let index = 0; index < y.length; index++) {
        if (!kept.has(index)) changed.push(start + index + 1);
    }
    return { added: y.length - common, removed: x.length - common, changed };
}
