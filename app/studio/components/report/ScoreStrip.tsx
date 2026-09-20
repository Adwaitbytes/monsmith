'use client';

import type { Finding, Grade, RepoReport, SectionKind, Severity } from '@/lib/report/types';
import { SECTION_KINDS, SECTION_LABELS, SEVERITIES } from '@/lib/report/types';
import type { ChainFitReport } from '@/lib/chainfit/report';
import type { GasProfile } from '@/lib/gasProfiler';
import type { ParallelAnalysisResult } from '@/lib/parallel/analyzer';

/**
 * The sticky head of the report rail.
 *
 * One number is allowed to be loud here. The health score and its grade are the
 * answer to the only question a first-time reader is actually asking, so they
 * get the display face and the size, and everything underneath is deliberately
 * quieter than it could be. The severity bar sits directly below because the
 * shape of a problem reads faster than its arithmetic: a wide red band says more
 * in a glance than "3 critical" does in a sentence, and the numbers are still
 * there for anyone who wants them.
 *
 * The section chips are navigation disguised as a summary. Each one carries a
 * true value pulled from the report rather than a label, which means the strip
 * doubles as a table of contents that is worth reading on its own.
 *
 * The rollup maths lives in this file because the strip is where it is first
 * needed, and the rail imports it rather than deriving a second answer that
 * could quietly disagree with this one.
 */

// ============= DEFENSIVE READS =============

/**
 * Sections arrive over a stream and a redacted payload deliberately omits the
 * fields its type promises, so anything reached through `data` is treated as
 * possibly absent even where the compiler believes otherwise.
 */
export function asList<T>(value: readonly T[] | undefined): readonly T[] {
    return Array.isArray(value) ? value : [];
}

export function asFinite(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// ============= SHARED ROLLUPS =============

export type RollupStatus = 'none' | 'pending' | 'ok' | 'failed' | 'mixed';

/** How a single section stands once every contract in the report is counted. */
export function rollupStatus(report: RepoReport, kind: SectionKind): RollupStatus {
    const contracts = asList(report.contracts);
    if (contracts.length === 0) return 'none';

    let ok = 0;
    let failed = 0;
    let pending = 0;

    for (const contract of contracts) {
        const section = contract.sections?.[kind];
        if (section === undefined || section.status === 'pending') pending += 1;
        else if (section.status === 'ok') ok += 1;
        else failed += 1;
    }

    if (ok > 0 && failed === 0 && pending === 0) return 'ok';
    if (failed > 0 && ok === 0 && pending === 0) return 'failed';
    if (pending > 0 && ok === 0 && failed === 0) return 'pending';
    return 'mixed';
}

/** Which rail section a finding belongs under. AI findings read as security. */
export const SECTION_OF_SOURCE: Readonly<Record<Finding['source'], SectionKind>> = {
    security: 'security',
    ai: 'security',
    parallel: 'parallel',
    gas: 'gas',
    chainfit: 'chainfit',
};

export function findingsForSection(report: RepoReport, kind: SectionKind): Finding[] {
    const out: Finding[] = [];
    for (const contract of asList(report.contracts)) {
        for (const finding of asList(contract.findings)) {
            if (SECTION_OF_SOURCE[finding.source] === kind) out.push(finding);
        }
    }
    return out;
}

/** Gas figures run to seven digits, which no chip has room for. */
export function compactGas(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
    if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
    return String(Math.round(value));
}

const GRADE_ORDER: readonly Grade[] = ['A', 'B', 'C', 'D', 'F'];

export const GRADE_TONE: Readonly<Record<Grade, string>> = {
    A: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    B: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    C: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    D: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
    F: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
};

function isGrade(value: string): value is Grade {
    return (GRADE_ORDER as readonly string[]).includes(value);
}

/** The least flattering parallel grade across the report, which is the honest one. */
function worstParallelGrade(report: RepoReport): Grade | null {
    let worst: Grade | null = null;

    for (const contract of asList(report.contracts)) {
        const section = contract.sections?.parallel;
        if (section?.status !== 'ok') continue;
        const data = section.data as ParallelAnalysisResult | undefined;
        const grade = data?.grade;
        if (typeof grade !== 'string' || !isGrade(grade)) continue;
        if (worst === null || GRADE_ORDER.indexOf(grade) > GRADE_ORDER.indexOf(worst)) worst = grade;
    }

    return worst;
}

/** Total deploy gas across every contract that produced a bounded estimate. */
function totalDeployGas(report: RepoReport): number | null {
    let total = 0;
    let measured = false;

    for (const contract of asList(report.contracts)) {
        const section = contract.sections?.gas;
        if (section?.status !== 'ok') continue;
        const data = section.data as GasProfile | undefined;
        const cost = asFinite(data?.deployment?.totalCost);
        if (cost === null) continue;
        total += cost;
        measured = true;
    }

    return measured ? total : null;
}

/** True when at least one chain fit section actually produced chains to compare. */
function chainsCompared(report: RepoReport): number | null {
    let most: number | null = null;

    for (const contract of asList(report.contracts)) {
        const section = contract.sections?.chainfit;
        if (section?.status !== 'ok') continue;
        const data = section.data as ChainFitReport | undefined;
        const count = asList(data?.chains).length;
        if (count > 0 && (most === null || count > most)) most = count;
    }

    return most;
}

/**
 * The value shown on a section chip.
 *
 * Every branch returns something that was measured. A redacted report reaches
 * the fallbacks, which say "measured" rather than inventing a number, because a
 * chip that guesses is worse than a chip that admits the detail is behind the
 * unlock.
 */
function chipValue(report: RepoReport, kind: SectionKind): string {
    const status = rollupStatus(report, kind);
    if (status === 'none') return 'none';
    if (status === 'pending') return 'running';
    if (status === 'failed') return 'not measured';

    const partial = status === 'mixed';

    if (kind === 'security') {
        const count = findingsForSection(report, 'security').length;
        if (count === 0) return partial ? 'partial' : 'clear';
        return String(count);
    }

    if (kind === 'parallel') {
        const grade = worstParallelGrade(report);
        if (grade !== null) return grade;
        return partial ? 'partial' : 'measured';
    }

    if (kind === 'gas') {
        const total = totalDeployGas(report);
        if (total !== null) return compactGas(total);
        return partial ? 'partial' : 'measured';
    }

    const chains = chainsCompared(report);
    if (chains !== null) return `${chains} chains`;
    return partial ? 'partial' : 'measured';
}

// ============= SEVERITY BAR =============

const SEVERITY_BAR: Readonly<Record<Severity, string>> = {
    critical: 'bg-red-500',
    high: 'bg-orange-500',
    medium: 'bg-amber-500',
    low: 'bg-emerald-500',
    info: 'bg-slate-400',
};

const SEVERITY_TEXT: Readonly<Record<Severity, string>> = {
    critical: 'text-red-600 dark:text-red-400',
    high: 'text-orange-600 dark:text-orange-400',
    medium: 'text-amber-600 dark:text-amber-400',
    low: 'text-emerald-600 dark:text-emerald-400',
    info: 'text-slate-500 dark:text-slate-400',
};

function countOf(report: RepoReport, severity: Severity): number {
    const value = report.counts?.[severity];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function SeverityBar({ report }: { report: RepoReport }) {
    const entries = SEVERITIES.map((severity) => ({ severity, count: countOf(report, severity) }));
    const total = entries.reduce((sum, entry) => sum + entry.count, 0);

    const label =
        total === 0
            ? 'No findings recorded'
            : entries
                  .filter((entry) => entry.count > 0)
                  .map((entry) => `${entry.count} ${entry.severity}`)
                  .join(', ');

    return (
        <div className="mt-3.5">
            <div
                role="img"
                aria-label={`Findings by severity: ${label}`}
                className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-border-subtle"
            >
                {entries
                    .filter((entry) => entry.count > 0)
                    .map((entry) => (
                        <span
                            key={entry.severity}
                            style={{ flexGrow: entry.count }}
                            className={`h-full transition-[flex-grow] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${SEVERITY_BAR[entry.severity]}`}
                        />
                    ))}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1" aria-hidden="true">
                {total === 0 ? (
                    <span className="text-[11px] text-text-muted">No findings recorded</span>
                ) : (
                    entries
                        .filter((entry) => entry.count > 0)
                        .map((entry) => (
                            <span key={entry.severity} className="flex items-center gap-1.5 text-[11px] text-text-muted">
                                <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_BAR[entry.severity]}`} />
                                <span className={`font-mono tabular-nums ${SEVERITY_TEXT[entry.severity]}`}>{entry.count}</span>
                                {entry.severity}
                            </span>
                        ))
                )}
            </div>
        </div>
    );
}

// ============= THE STRIP =============

export interface ScoreStripProps {
    report: RepoReport;
    /** Highlights the chip whose section is currently under the reader's eye. */
    activeSection: SectionKind | null;
    onJump: (section: SectionKind) => void;
}

export function ScoreStrip({ report, activeSection, onJump }: ScoreStripProps) {
    const health = report.health;
    const score = asFinite(health?.score);
    const grade = health?.grade;

    return (
        <header className="sticky top-0 z-20 border-b border-border-subtle bg-surface-raised/95 px-5 pb-3.5 pt-4 backdrop-blur-xl">
            <div className="flex items-start gap-4">
                <div className="flex shrink-0 items-baseline gap-2">
                    <span className="font-display text-[44px] font-semibold leading-none tracking-tight tabular-nums text-text-primary">
                        {score === null ? '--' : Math.round(score)}
                    </span>
                    {grade !== undefined && (
                        <span
                            className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold leading-none ${GRADE_TONE[grade] ?? ''}`}
                        >
                            {grade}
                        </span>
                    )}
                </div>

                <div className="min-w-0 flex-1 pt-0.5">
                    <h2 className="text-[11px] font-medium uppercase tracking-wider text-text-muted">Contract report</h2>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">
                        {health?.headline ?? 'Scores appear as each contract finishes.'}
                    </p>
                </div>
            </div>

            <SeverityBar report={report} />

            {/*
              Wrapping rather than scrolling. The rail is narrow and there are
              only ever four of these, so a hidden-scrollbar row buys nothing
              and costs the reader a chip cut off mid-word, which reads as a
              rendering fault rather than as something to scroll.
            */}
            <nav aria-label="Report sections" className="-mx-1 mt-3.5 flex flex-wrap gap-1.5 px-1 pb-0.5">
                {SECTION_KINDS.map((kind) => {
                    const active = activeSection === kind;
                    return (
                        <button
                            key={kind}
                            type="button"
                            onClick={() => onJump(kind)}
                            aria-current={active ? 'true' : undefined}
                            className={`group flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised motion-reduce:transition-none ${
                                active
                                    ? 'border-accent-line bg-accent-soft text-accent'
                                    : 'border-border-subtle text-text-secondary hover:border-border-strong hover:bg-surface-sunken'
                            }`}
                        >
                            <span className="whitespace-nowrap">{SECTION_LABELS[kind]}</span>
                            <span
                                className={`font-mono text-[11px] tabular-nums ${active ? 'text-accent' : 'text-text-muted group-hover:text-text-primary'}`}
                            >
                                {chipValue(report, kind)}
                            </span>
                        </button>
                    );
                })}
            </nav>
        </header>
    );
}

export default ScoreStrip;
