/**
 * An optimization as one document: what the contract scored, what changed and
 * why, and both versions of the code.
 *
 * The result screen shows this live; the download is what a developer takes
 * into a pull request or hands to a reviewer, so it has to stand on its own:
 * the numbers, the reasons, the diff, and the two sources in full.
 */

import type { OptimizeResult, ScoreSnapshot } from './types';

/** A unified diff of two sources, with `context` unchanged lines around each change. */
export function unifiedDiff(before: string, after: string, path: string, context = 3): string {
    // A trailing newline ends the last line; it does not start an empty one.
    const linesOf = (text: string) => (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
    const a = linesOf(before);
    const b = linesOf(after);

    // Longest common subsequence over lines, after trimming the shared head
    // and tail, which keeps the table small because edits are local.
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
    let tailA = a.length;
    let tailB = b.length;
    while (tailA > head && tailB > head && a[tailA - 1] === b[tailB - 1]) {
        tailA -= 1;
        tailB -= 1;
    }
    const x = a.slice(head, tailA);
    const y = b.slice(head, tailB);
    const table: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
    for (let i = x.length - 1; i >= 0; i--) {
        for (let j = y.length - 1; j >= 0; j--) {
            table[i][j] = x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }

    type Line = { kind: ' ' | '-' | '+'; text: string; oldNo: number; newNo: number };
    const lines: Line[] = [];
    for (let index = 0; index < head; index++) lines.push({ kind: ' ', text: a[index], oldNo: index + 1, newNo: index + 1 });
    let i = 0;
    let j = 0;
    while (i < x.length || j < y.length) {
        if (i < x.length && j < y.length && x[i] === y[j]) {
            lines.push({ kind: ' ', text: x[i], oldNo: head + i + 1, newNo: head + j + 1 });
            i += 1;
            j += 1;
        } else if (i < x.length && (j >= y.length || table[i + 1][j] >= table[i][j + 1])) {
            // Removals before additions, the order every diff tool prints.
            lines.push({ kind: '-', text: x[i], oldNo: head + i + 1, newNo: head + j });
            i += 1;
        } else {
            lines.push({ kind: '+', text: y[j], oldNo: head + i, newNo: head + j + 1 });
            j += 1;
        }
    }
    for (let index = tailA; index < a.length; index++) {
        lines.push({ kind: ' ', text: a[index], oldNo: index + 1, newNo: index - tailA + tailB + 1 });
    }

    // Group changed lines, with their context, into hunks.
    const changed = lines.map((line, index) => (line.kind === ' ' ? -1 : index)).filter((index) => index >= 0);
    if (changed.length === 0) return '';
    const hunks: Array<[number, number]> = [];
    for (const index of changed) {
        const start = Math.max(0, index - context);
        const end = Math.min(lines.length - 1, index + context);
        const last = hunks[hunks.length - 1];
        if (last !== undefined && start <= last[1] + 1) last[1] = Math.max(last[1], end);
        else hunks.push([start, end]);
    }

    const out = [`--- a/${path}`, `+++ b/${path}`];
    for (const [start, end] of hunks) {
        const slice = lines.slice(start, end + 1);
        const oldCount = slice.filter((line) => line.kind !== '+').length;
        const newCount = slice.filter((line) => line.kind !== '-').length;
        const firstOld = slice.find((line) => line.kind !== '+')?.oldNo ?? slice[0].oldNo;
        const firstNew = slice.find((line) => line.kind !== '-')?.newNo ?? slice[0].newNo;
        out.push(`@@ -${firstOld},${oldCount} +${firstNew},${newCount} @@`);
        for (const line of slice) out.push(`${line.kind}${line.text}`);
    }
    return out.join('\n');
}

function score(snapshot: ScoreSnapshot): string {
    return snapshot.score === null ? 'n/a' : `${snapshot.score}${snapshot.grade === null ? '' : ` (${snapshot.grade})`}`;
}

function number(value: number | null): string {
    return value === null ? 'n/a' : value.toLocaleString('en-US');
}

function change(before: number | null, after: number | null): string {
    if (before === null || after === null) return '';
    const delta = after - before;
    return delta === 0 ? 'unchanged' : `${delta > 0 ? '+' : ''}${delta.toLocaleString('en-US')}`;
}

/** Long dashes read as machine written; the product's copy does not use them. */
function plain(text: string): string {
    return text.replace(/\s*—\s*/g, ': ');
}

export function optimizationToMarkdown(result: OptimizeResult, links: { before?: string; after?: string } = {}): string {
    const { before, after } = result;
    const name = result.path.split('/').pop() ?? result.path;
    const rows: Array<[string, string, string, string]> = [
        ['Score', score(before), score(after), change(before.score, after.score)],
        ['Critical', String(before.counts.critical), String(after.counts.critical), change(before.counts.critical, after.counts.critical)],
        ['High', String(before.counts.high), String(after.counts.high), change(before.counts.high, after.counts.high)],
        ['Medium', String(before.counts.medium), String(after.counts.medium), change(before.counts.medium, after.counts.medium)],
        ['Low', String(before.counts.low), String(after.counts.low), change(before.counts.low, after.counts.low)],
        ['Deploy gas', number(before.deployGas), number(after.deployGas), change(before.deployGas, after.deployGas)],
        ['Parallel score', number(before.parallelScore), number(after.parallelScore), change(before.parallelScore, after.parallelScore)],
    ];
    const diff = unifiedDiff(result.original, result.optimized, result.path);

    return [
        `# Optimization of ${name}`,
        '',
        'Generated by Monsmith. Every change below compiled with the contract\'s own compiler, kept every public function and event, and was measured by running the full report again on the new code.',
        '',
        '## Before and after',
        '',
        '| | Before | After | Change |',
        '| --- | ---: | ---: | ---: |',
        ...rows.map((row) => `| ${row.join(' | ')} |`),
        '',
        ...(links.before !== undefined || links.after !== undefined
            ? [
                  ...(links.before !== undefined ? [`Report before: ${links.before}`] : []),
                  ...(links.after !== undefined ? [`Report after: ${links.after}`] : []),
                  '',
              ]
            : []),
        result.improved ? '' : '> These changes did not raise the score when the report ran again. They are included in case any of them is useful.\n',
        `## What changed (${result.changes.length} ${result.changes.length === 1 ? 'change' : 'changes'}, +${result.lines.added} -${result.lines.removed} lines)`,
        '',
        ...result.changes.flatMap((entry, index) => [
            `### ${index + 1}. ${plain(entry.title)}`,
            '',
            ...(entry.why.length > 0 ? [plain(entry.why), ''] : []),
            ...(entry.fixes.length > 0 ? [`Fixes: ${entry.fixes.map(plain).join('; ')}`, ''] : []),
        ]),
        '## The diff',
        '',
        '```diff',
        diff.length > 0 ? diff : '(no changes)',
        '```',
        '',
        '## Original contract',
        '',
        '```solidity',
        result.original.trimEnd(),
        '```',
        '',
        '## Optimized contract',
        '',
        '```solidity',
        result.optimized.trimEnd(),
        '```',
        '',
        '---',
        '',
        'Review these changes before deploying. An automated optimization is a strong first pass, not a substitute for a human review when real money is at stake.',
        '',
    ]
        .join('\n')
        .replace(/\n{3,}/g, '\n\n');
}
