/**
 * The Contract Report.
 *
 * One artifact assembled from every analysis the product runs, so that a single
 * click answers "is this contract good?" instead of asking the reader to open
 * six panels and hold the pieces in their head.
 *
 * This file is the contract between the engine that builds a report, the rail
 * that renders one, the redactor that decides how much of one a free viewer
 * sees, and the route that streams one. Nothing else may define these shapes:
 * a second definition is how a paid field quietly leaks into a free response.
 *
 * Every section is independently optional and independently failable. A repo
 * where one contract times out under the local EVM still produces a report for
 * the other eleven, and the one that failed says why rather than disappearing.
 */

import type { ChainFitReport } from '../chainfit/report';
import type { GasProfile } from '../gasProfiler';
import type { ParallelAnalysisResult } from '../parallel/analyzer';

// ============= FINDINGS =============

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Ordered worst-first, which is also the order findings are presented in. */
export const SEVERITIES: readonly Severity[] = [
    'critical',
    'high',
    'medium',
    'low',
    'info',
] as const;

/** How much a severity costs the health score, per occurrence. */
export const SEVERITY_WEIGHT: Readonly<Record<Severity, number>> = {
    critical: 30,
    high: 15,
    medium: 6,
    low: 2,
    info: 0,
};

/**
 * One thing worth knowing about a contract.
 *
 * `evidence` and `fix` are the paid half. They are separated from the title and
 * severity deliberately: the free report can prove a finding exists and how bad
 * it is without giving away what it is or how to repair it.
 */
export interface Finding {
    id: string;
    severity: Severity;
    /** Short, readable, safe to show for free on the two cheapest findings. */
    title: string;
    /** Which engine produced it, so a reader can weigh it. */
    source: 'security' | 'parallel' | 'gas' | 'chainfit' | 'ai';
    /** Workspace-relative path the finding lives in, when known. */
    file?: string;
    line?: number;
    /** Paid. Why this matters, at length. */
    description?: string;
    /** Paid. The offending source, a few lines of it. */
    evidence?: string;
    /** Paid. What to do about it. */
    fix?: string;
    /** Paid. A unified diff the editor can apply, when the fix is mechanical. */
    patch?: string;
}

export type SeverityCounts = Readonly<Record<Severity, number>>;

export function emptyCounts(): SeverityCounts {
    return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

export function countBySeverity(findings: readonly Finding[]): SeverityCounts {
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const finding of findings) counts[finding.severity] += 1;
    return counts;
}

// ============= SECTIONS =============

export type SectionKind = 'security' | 'parallel' | 'gas' | 'chainfit';

export const SECTION_KINDS: readonly SectionKind[] = [
    'security',
    'parallel',
    'gas',
    'chainfit',
] as const;

export const SECTION_LABELS: Readonly<Record<SectionKind, string>> = {
    security: 'Security',
    parallel: 'Parallel execution',
    gas: 'Gas and cost',
    chainfit: 'Chain fit',
};

/**
 * A section that could not be produced.
 *
 * Kept as data rather than thrown away, because "we did not measure this, and
 * here is why" is information, and silently omitting a section reads as a pass.
 */
export interface SectionFailure {
    reason: string;
    /** True when the section ran out of its time budget rather than erroring. */
    timedOut: boolean;
}

export type Section<T> =
    | { status: 'pending' }
    | { status: 'ok'; data: T; durationMs: number }
    | { status: 'failed'; failure: SectionFailure };

export function pending<T>(): Section<T> {
    return { status: 'pending' };
}

export function isOk<T>(section: Section<T> | undefined): section is {
    status: 'ok';
    data: T;
    durationMs: number;
} {
    return section?.status === 'ok';
}

/** Narrow shape of the security engine's output, which has no exported type. */
export interface SecurityAnalysis {
    issues: Array<{
        severity: Severity;
        title: string;
        description: string;
        line?: number;
        recommendation: string;
    }>;
    score?: number;
}

export interface ContractSections {
    security: Section<SecurityAnalysis>;
    parallel: Section<ParallelAnalysisResult>;
    gas: Section<GasProfile>;
    chainfit: Section<ChainFitReport>;
}

// ============= HEALTH =============

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export function gradeFor(score: number): Grade {
    if (score >= 90) return 'A';
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    if (score >= 40) return 'D';
    return 'F';
}

/**
 * The headline number.
 *
 * Security dominates because an exploitable contract is not improved by being
 * cheap or parallel. Parallel fitness is weighted meaningfully rather than as a
 * footnote, since it is the measurement this product exists to make.
 */
export interface Health {
    score: number;
    grade: Grade;
    /** One sentence, plain, safe to show free. */
    headline: string;
}

// ============= THE REPORT =============

/** Why a contract in the repository was not audited. */
export type SkipReason =
    | 'test-file'
    | 'interface-only'
    | 'dependency'
    | 'over-cap'
    | 'no-contract';

export interface SkippedContract {
    path: string;
    reason: SkipReason;
}

export interface ContractReport {
    /** Stable within a report. The workspace path, which is already unique. */
    id: string;
    path: string;
    /** The contract solc considers the artifact, not the filename. */
    name: string;
    health: Health | null;
    findings: Finding[];
    counts: SeverityCounts;
    sections: ContractSections;
}

export type ReportOrigin =
    | { kind: 'workspace' }
    | { kind: 'address'; address: string; chainId: number }
    | { kind: 'github'; owner: string; repo: string; ref: string; private: boolean };

export interface RepoReport {
    reportId: string;
    createdAt: string;
    origin: ReportOrigin;
    /** Rolled up across every contract that produced a health score. */
    health: Health | null;
    counts: SeverityCounts;
    contracts: ContractReport[];
    skipped: SkippedContract[];
    /** Plain-text notes about what was and was not measured, always shown. */
    notes: string[];
    /** True when this payload has been through `redactReport`. */
    redacted: boolean;
}

// ============= STREAM PROTOCOL =============

/**
 * What the streaming route emits.
 *
 * A discriminated union rather than loose JSON, because the client renders
 * straight off these and a typo in an event name would otherwise fail silently
 * as a section that never arrives.
 */
export type ReportEvent =
    | { type: 'started'; reportId: string; planned: Array<{ id: string; path: string }>; skipped: SkippedContract[] }
    | { type: 'section'; contractId: string; section: SectionKind; result: Section<unknown> }
    | { type: 'contract'; contract: ContractReport }
    | { type: 'progress'; done: number; total: number; label: string }
    | { type: 'complete'; report: RepoReport }
    | { type: 'error'; message: string };

// ============= BUDGETS =============

/** Per-contract wall clock before a section is abandoned as unmeasured. */
export const CONTRACT_BUDGET_MS = 25_000;

/** Contracts audited in one report, by tier. Over this, the largest win. */
export const CONTRACT_CAP: Readonly<Record<'free' | 'pro' | 'enterprise', number>> = {
    free: 10,
    pro: 50,
    enterprise: 200,
};
