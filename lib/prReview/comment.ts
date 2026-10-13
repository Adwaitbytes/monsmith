/**
 * The comment Monsmith keeps on a pull request.
 *
 * One comment, edited in place on every push, never a new one per push: a bot
 * that adds a comment each time someone pushes is a bot people uninstall. The
 * hidden marker is how the comment is found again when its id was not stored.
 *
 * It leads with what changed since the last push, because that is the question
 * the author has when they come back to the tab: did my fix work. The full list
 * of what is still open comes after, worst first, each finding linked to the
 * exact line at the reviewed commit so it cannot drift as the branch moves.
 */

import type { Finding, RepoReport, Severity } from '../report/types';
import type { PushDelta, TrackedFinding } from './tracking';

export const COMMENT_MARKER = '<!-- monsmith:pr-review -->';

/** GitHub refuses comments over 65,536 characters; this leaves room for the footer. */
const BODY_BUDGET = 60_000;

/** Findings explained at length. The rest are listed by title, with the report a click away. */
const DETAILED = 12;

export interface MergeOutcome {
    attested: Array<{ path: string; txUrl: string }>;
    notAttested: Array<{ path: string; reason: string }>;
}

export interface CommentInput {
    report: RepoReport;
    reportUrl: string;
    headSha: string;
    /** A permalink to a line of a file at the reviewed commit. */
    blobUrl: (path: string, line: number | null) => string;
    delta: PushDelta;
    /** Each contract's score at the first review of this pull request. */
    firstScores: Readonly<Record<string, number>>;
    /** Findings fixed across every push to this pull request so far. */
    fixedSoFar: number;
    /** Changed Solidity that was not audited, and why. */
    notAudited: ReadonlyArray<{ path: string; reason: string }>;
    /** Set once the pull request has merged. */
    merge?: MergeOutcome | null;
    siteUrl: string;
}

const LABEL: Readonly<Record<Severity, string>> = {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    info: 'Info',
};

function plural(count: number, one: string, many = `${one}s`): string {
    return `${count} ${count === 1 ? one : many}`;
}

/** Text from a model or a repository, made safe to sit inside Markdown and HTML. */
function escape(text: string): string {
    return text.replace(/[<>]/g, (char) => (char === '<' ? '&lt;' : '&gt;')).replace(/\|/g, '\\|');
}

function shortSha(sha: string): string {
    return sha.slice(0, 7);
}

function where(finding: { path: string; line: number | null }, blobUrl: CommentInput['blobUrl']): string {
    const label = `${finding.path}${finding.line !== null ? `:${finding.line}` : ''}`;
    return `[\`${label}\`](${blobUrl(finding.path, finding.line)})`;
}

function headline(input: CommentInput): string {
    const { delta } = input;
    const open = delta.open.length;
    if (input.merge !== undefined && input.merge !== null) {
        return open === 0 ? 'Merged with no open security findings' : `Merged with ${plural(open, 'open finding')}`;
    }
    if (delta.firstReview) {
        return open === 0
            ? 'No security findings in the contracts this pull request changes'
            : `${plural(open, 'security finding')} in the contracts this pull request changes`;
    }
    const parts: string[] = [];
    if (delta.fixed.length > 0) parts.push(`this push fixed ${plural(delta.fixed.length, 'finding')}`);
    if (delta.introduced.length > 0) parts.push(`introduced ${plural(delta.introduced.length, 'new one')}`);
    if (parts.length === 0) return open === 0 ? 'Still clean after this push' : `No change since the last push, ${plural(open, 'finding')} still open`;
    const sentence = parts.join(' and ');
    return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function scoreTable(input: CommentInput): string[] {
    const rows = input.report.contracts.map((contract) => {
        const score = contract.health?.score;
        const first = input.firstScores[contract.path];
        const movement =
            score === undefined || first === undefined || first === score
                ? ''
                : ` (${first} at the first review)`;
        const c = contract.counts;
        return `| [\`${contract.path}\`](${input.blobUrl(contract.path, null)}) | ${score === undefined ? 'not scored' : `**${score}** ${contract.health?.grade ?? ''}${movement}`} | ${c.critical} | ${c.high} | ${c.medium} | ${c.low} |`;
    });
    return ['| Contract | Score | Critical | High | Medium | Low |', '| --- | --- | ---: | ---: | ---: | ---: |', ...rows];
}

function findingDetail(report: RepoReport, tracked: TrackedFinding): Finding | undefined {
    const contract = report.contracts.find((entry) => entry.path === tracked.path);
    return contract?.findings.find((finding) => finding.source === tracked.source && finding.title === tracked.title);
}

function detailBlock(input: CommentInput, tracked: TrackedFinding): string[] {
    const finding = findingDetail(input.report, tracked);
    const lines = [
        '<details>',
        `<summary><b>${LABEL[tracked.severity]}</b> · ${escape(tracked.title)}</summary>`,
        '',
        `Where: ${where(tracked, input.blobUrl)}`,
    ];
    if (finding?.description !== undefined && finding.description.length > 0) lines.push('', escape(finding.description.slice(0, 1_800)));
    if (finding?.evidence !== undefined && finding.evidence.trim().length > 0) {
        lines.push('', '```solidity', finding.evidence.slice(0, 900).replace(/```/g, "'''"), '```');
    }
    if (finding?.fix !== undefined && finding.fix.length > 0) lines.push('', `**Fix:** ${escape(finding.fix.slice(0, 1_200))}`);
    lines.push('', '</details>');
    return lines;
}

export function renderComment(input: CommentInput): string {
    const { delta, report } = input;
    const out: string[] = [COMMENT_MARKER, `### Monsmith · ${headline(input)}`, ''];

    out.push(
        `Reviewed commit \`${shortSha(input.headSha)}\`. ${plural(report.contracts.length, 'contract')} audited${input.fixedSoFar > 0 ? `, ${plural(input.fixedSoFar, 'finding')} fixed on this pull request so far` : ''}.`,
        '',
    );

    if (report.contracts.length > 0) out.push(...scoreTable(input), '');

    if (input.merge !== undefined && input.merge !== null) {
        const { attested, notAttested } = input.merge;
        if (attested.length > 0) {
            out.push('**Attested on Monad.** The reviewed source of each contract below now has its score onchain, so anyone can check it before calling the deployed code:', '');
            for (const entry of attested) out.push(`- \`${entry.path}\`: [transaction](${entry.txUrl})`);
            out.push('');
        }
        for (const entry of notAttested) out.push(`- \`${entry.path}\` was not attested: ${escape(entry.reason)}`);
        if (notAttested.length > 0) out.push('');
    }

    if (delta.fixed.length > 0) {
        out.push(`**Fixed by this push**`, '');
        for (const finding of delta.fixed) out.push(`- ~~${escape(finding.title)}~~ (${LABEL[finding.severity]}) in \`${finding.path}\``);
        out.push('');
    }

    if (delta.introduced.length > 0) {
        out.push(`**New in this push**`, '');
        for (const finding of delta.introduced) out.push(`- **${LABEL[finding.severity]}** · ${escape(finding.title)} · ${where(finding, input.blobUrl)}`);
        out.push('');
    }

    if (delta.open.length > 0) {
        out.push(`**Open findings** (${delta.open.length}), worst first`, '');
        let used = out.join('\n').length;
        for (const [index, finding] of delta.open.entries()) {
            const block = index < DETAILED ? detailBlock(input, finding) : [`- **${LABEL[finding.severity]}** · ${escape(finding.title)} · ${where(finding, input.blobUrl)}`];
            const text = block.join('\n');
            if (used + text.length > BODY_BUDGET) {
                out.push(`- ${plural(delta.open.length - index, 'more finding')} in the [full report](${input.reportUrl}).`);
                break;
            }
            out.push(...block);
            used += text.length + 1;
        }
        out.push('');
    }

    const notes = report.notes.filter((note) => !note.startsWith('A repository is only as safe'));
    if (notes.length > 0) {
        out.push('<details>', '<summary>How this was checked</summary>', '');
        for (const note of notes) out.push(`- ${escape(note)}`);
        out.push('', '</details>', '');
    }

    if (input.notAudited.length > 0) {
        out.push(`Not audited: ${input.notAudited.map((entry) => `\`${entry.path}\` (${entry.reason})`).join(', ')}.`, '');
    }

    out.push(
        '---',
        `[Full report](${input.reportUrl}) · Each push re-checks the earlier findings and re-audits the changed contracts in full · When this merges, the reviewed code is attested on Monad · [Monsmith](${input.siteUrl}/github)`,
    );

    return out.join('\n');
}

/** The short form for a pull request over its monthly allowance. */
export function renderLimitComment(siteUrl: string, limit: number): string {
    return [
        COMMENT_MARKER,
        '### Monsmith · Monthly review limit reached',
        '',
        `This installation has used its ${limit} free pull request reviews for the last 30 days, so this push was not reviewed. Reviews start again as older ones age out, or you can run a full report by hand at [monsmith.com](${siteUrl}).`,
    ].join('\n');
}

/** The one-line summary that goes on the check run. */
export function checkSummary(input: CommentInput): { title: string; summary: string } {
    const counts = input.report.counts;
    return {
        title: headline(input),
        summary: [
            `Reviewed \`${shortSha(input.headSha)}\`: ${plural(input.report.contracts.length, 'contract')}, ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low.`,
            input.delta.fixed.length > 0 ? `Fixed by this push: ${input.delta.fixed.map((finding) => finding.title).join('; ')}.` : '',
            `Full report: ${input.reportUrl}`,
        ]
            .filter((line) => line.length > 0)
            .join('\n\n'),
    };
}
