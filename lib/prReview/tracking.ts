/**
 * What changed between two reviews of the same pull request.
 *
 * The number a security reviewer on a pull request is judged by is not how many
 * findings it posts but how many of them get fixed before the code merges.
 * That needs a finding to be recognisable across pushes, so each one gets a key
 * from where it lives and what it is called. Line numbers are left out on
 * purpose: a fix that adds three lines above a finding moves it, and a key that
 * moved with it would count every untouched finding as fixed and found again.
 *
 * Titles are stable enough to key on because a contract changed by a push is
 * re-audited as a fix review, which carries each earlier finding forward under
 * its exact title, and the static rules always produce the same title.
 */

import { SEVERITIES, type ContractReport, type RepoReport, type Severity } from '../report/types';

export interface TrackedFinding {
    key: string;
    path: string;
    severity: Severity;
    title: string;
    line: number | null;
    source: 'security' | 'ai';
}

export interface PushDelta {
    /** True when there is no earlier review of this pull request to compare with. */
    firstReview: boolean;
    /** Earlier findings in a re-audited contract that this push no longer has. */
    fixed: TrackedFinding[];
    /** Findings this push has that the earlier review of the same contract did not. */
    introduced: TrackedFinding[];
    /** Everything still open after this push, worst first. */
    open: TrackedFinding[];
}

/** Findings that would block a merge if a person read them: security, not gas or style. */
function isTracked(finding: ContractReport['findings'][number]): finding is ContractReport['findings'][number] & { source: 'security' | 'ai' } {
    return (finding.source === 'security' || finding.source === 'ai') && finding.severity !== 'info';
}

export function normaliseTitle(title: string): string {
    return title
        .toLowerCase()
        .replace(/[`'"]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

export function findingKey(path: string, source: string, title: string): string {
    return `${path}::${source}::${normaliseTitle(title)}`;
}

export function bySeverity(a: { severity: Severity }, b: { severity: Severity }): number {
    return SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);
}

/** The findings of a report worth following from push to push, worst first. */
export function trackedFindings(report: RepoReport): TrackedFinding[] {
    const tracked: TrackedFinding[] = [];
    const seen = new Set<string>();
    for (const contract of report.contracts) {
        for (const finding of contract.findings) {
            if (!isTracked(finding)) continue;
            const key = findingKey(contract.path, finding.source, finding.title);
            // Two findings with one title in one file are one thing to fix.
            if (seen.has(key)) continue;
            seen.add(key);
            tracked.push({
                key,
                path: contract.path,
                severity: finding.severity,
                title: finding.title,
                line: finding.line ?? null,
                source: finding.source,
            });
        }
    }
    return tracked.sort(bySeverity);
}

/**
 * Compares this push with the previous review of the same pull request.
 *
 * Only contracts audited in both count. A finding in a file the push deleted, or
 * one this run did not audit, has not been fixed, it has stopped being looked
 * at, and crediting it as a fix is exactly the padding a retention metric must
 * not have.
 */
export function compareReviews(
    previous: readonly TrackedFinding[] | null,
    current: readonly TrackedFinding[],
    auditedPaths: ReadonlySet<string>,
): PushDelta {
    const open = [...current].sort(bySeverity);
    if (previous === null) return { firstReview: true, fixed: [], introduced: [], open };

    const previousPaths = new Set(previous.map((finding) => finding.path));
    const currentKeys = new Set(current.map((finding) => finding.key));
    const previousKeys = new Set(previous.map((finding) => finding.key));

    const fixed = previous.filter((finding) => auditedPaths.has(finding.path) && !currentKeys.has(finding.key));
    const introduced = current.filter(
        (finding) => !previousKeys.has(finding.key) && (previousPaths.has(finding.path) || auditedPaths.has(finding.path)),
    );

    return { firstReview: false, fixed: fixed.sort(bySeverity), introduced: introduced.sort(bySeverity), open };
}

export type CheckConclusion = 'success' | 'failure';

/** A pull request with a critical or high finding open should not merge without someone looking. */
export function conclusionFor(open: readonly TrackedFinding[]): CheckConclusion {
    return open.some((finding) => finding.severity === 'critical' || finding.severity === 'high') ? 'failure' : 'success';
}

export interface CheckAnnotation {
    path: string;
    start_line: number;
    end_line: number;
    annotation_level: 'failure' | 'warning' | 'notice';
    title: string;
    message: string;
}

/** GitHub takes at most fifty annotations per request. */
export const MAX_ANNOTATIONS = 50;

const LEVEL: Readonly<Record<Severity, CheckAnnotation['annotation_level']>> = {
    critical: 'failure',
    high: 'failure',
    medium: 'warning',
    low: 'notice',
    info: 'notice',
};

/**
 * Inline annotations for the "Files changed" tab, so a finding sits on the line
 * it is about instead of only in a comment the author has to cross-reference.
 */
export function annotationsFor(report: RepoReport): CheckAnnotation[] {
    const annotations: CheckAnnotation[] = [];
    for (const contract of report.contracts) {
        for (const finding of contract.findings) {
            if (!isTracked(finding) || finding.line === undefined || finding.line < 1) continue;
            const detail = [finding.description, finding.fix !== undefined && finding.fix.length > 0 ? `Fix: ${finding.fix}` : '']
                .filter((part): part is string => part !== undefined && part.length > 0)
                .join('\n\n');
            annotations.push({
                path: contract.path,
                start_line: finding.line,
                end_line: finding.line,
                annotation_level: LEVEL[finding.severity],
                title: `${finding.severity.toUpperCase()}: ${finding.title}`.slice(0, 255),
                // GitHub caps an annotation message at 64 KB; a few paragraphs is what fits on a line.
                message: (detail.length > 0 ? detail : finding.title).slice(0, 2_000),
            });
        }
    }
    return annotations.sort((a, b) => levelRank(a.annotation_level) - levelRank(b.annotation_level)).slice(0, MAX_ANNOTATIONS);
}

function levelRank(level: CheckAnnotation['annotation_level']): number {
    return level === 'failure' ? 0 : level === 'warning' ? 1 : 2;
}
