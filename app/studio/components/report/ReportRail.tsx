'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, Loader2, MinusCircle, Play, RotateCw } from 'lucide-react';

import type { ChainFitReport } from '@/lib/chainfit/report';
import type { GasProfile } from '@/lib/gasProfiler';
import type { ParallelAnalysisResult } from '@/lib/parallel/analyzer';
import { summariseLocked } from '@/lib/report/redact';
import type {
    ContractReport,
    Finding,
    RepoReport,
    SecurityAnalysis,
    SectionFailure,
    SectionKind,
    SkipReason,
} from '@/lib/report/types';
import { SECTION_KINDS, SECTION_LABELS } from '@/lib/report/types';

import { FindingCard } from './FindingCard';
import {
    GRADE_TONE,
    ScoreStrip,
    SECTION_OF_SOURCE,
    asFinite,
    asList,
    compactGas,
    rollupStatus,
} from './ScoreStrip';
import { UnlockPanel } from './UnlockPanel';

/**
 * The right rail: one scrolling Contract Report.
 *
 * This replaces six icon toggles that each opened a panel, which meant the
 * product's answer to "is this contract good?" was assembled by the reader out
 * of parts they had to know to go looking for. The rail is always present and
 * always shows the same document in the same order, so the default state of the
 * studio is the finished answer rather than the raw materials for one.
 *
 * Three things drive the layout. It is one document and not tabs, because the
 * relationship between a gas number and the finding that caused it disappears
 * the moment they live on separate screens. The running state is designed as a
 * first-class view rather than a loading spinner, because a twelve-contract
 * repository takes minutes and a reader will spend that whole time here: each
 * section fills in as the stream delivers it and everything already measured
 * stays readable while the rest runs. And a section that could not be produced
 * renders as "not measured" with its reason in a quiet neutral treatment, since
 * a missing section that is silently omitted reads as a pass, and one dressed up
 * in red reads as a failure of the contract rather than of our measurement.
 */

// ============= STATE =============

export type RailState =
    | { status: 'empty' }
    | { status: 'running'; done: number; total: number; label: string; partial: RepoReport | null }
    | { status: 'ready'; report: RepoReport }
    | { status: 'error'; message: string };

export interface ReportRailProps {
    state: RailState;
    /** True when this viewer has paid for, or is otherwise owed, the full report. */
    entitled: boolean;
    onUnlock: () => void;
    unlocking: boolean;
    unlockError?: string | null;
    onApplyPatch?: (finding: Finding) => void;
    onRerun?: () => void;
    onOpenContract?: (contract: ContractReport) => void;
    /** Offered only on a finished report, from inside the report itself. */
    onShare?: () => void;
}

// ============= SMALL FORMATTERS =============

/** Sub-cent costs need more places than currency formatting gives by default. */
function usdText(value: number | null | undefined): string {
    const amount = asFinite(value);
    if (amount === null) return '-';
    if (amount === 0) return '$0';
    if (amount < 0.000001) return '<$0.000001';
    if (amount < 0.01) return `$${amount.toFixed(6)}`;
    return `$${amount.toFixed(4)}`;
}

function bytesText(value: number): string {
    return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`;
}

const SKIP_REASON_LABELS: Readonly<Record<SkipReason, string>> = {
    'test-file': 'Test file',
    'interface-only': 'Interface only, nothing to execute',
    dependency: 'Third-party dependency, not your code',
    'over-cap': 'Over the contract cap for this report',
    'no-contract': 'No deployable contract in the file',
};

function originText(report: RepoReport): string | null {
    const origin = report.origin;
    if (origin === undefined) return null;
    if (origin.kind === 'workspace') return 'From the editor workspace';
    if (origin.kind === 'address') return `From ${origin.address} on chain ${origin.chainId}`;
    if (origin.kind === 'github') return `From ${origin.owner}/${origin.repo} at ${origin.ref}`;
    return null;
}

function isSectionKind(value: string): value is SectionKind {
    return (SECTION_KINDS as readonly string[]).includes(value);
}

/**
 * Whether a finding's paid half was withheld.
 *
 * `redactReport` picks which findings survive in full, and re-deriving that
 * choice on the client would be a second implementation of the paywall that can
 * drift from the first. The absence of every paid field is the observable
 * consequence of its decision, and a finding carrying none of them has nothing
 * to show either way, so the locked treatment is correct for it regardless.
 */
function isLocked(report: RepoReport, entitled: boolean, finding: Finding): boolean {
    if (entitled || !report.redacted) return false;
    return finding.description === undefined && finding.evidence === undefined && finding.fix === undefined;
}

// ============= SHARED PIECES =============

function SectionHeading({ label, status }: { label: string; status: string | null }) {
    return (
        <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-text-muted">{label}</h3>
            {status !== null && (
                <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-wider text-text-muted">{status}</span>
            )}
        </div>
    );
}

function RailSection({
    anchor,
    label,
    status,
    innerRef,
    children,
}: {
    anchor: string;
    label: string;
    status: string | null;
    innerRef?: (element: HTMLElement | null) => void;
    children: ReactNode;
}) {
    return (
        <section
            ref={innerRef}
            data-section={anchor}
            aria-label={label}
            className="scroll-mt-4 border-t border-border-subtle px-5 py-5 first:border-t-0"
        >
            <SectionHeading label={label} status={status} />
            {children}
        </section>
    );
}

/** A section still being produced. Bars rather than a spinner, so the shape of what is coming is already on screen. */
function PendingBody({ note }: { note: string }) {
    return (
        <div className="rounded-lg border border-border-subtle bg-surface-sunken px-3 py-3">
            <div className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin text-text-muted motion-reduce:animate-none" strokeWidth={2} aria-hidden="true" />
                <span className="text-[11.5px] text-text-muted">{note}</span>
            </div>
            <div className="mt-2.5 space-y-1.5" aria-hidden="true">
                {['82%', '64%'].map((width) => (
                    <span
                        key={width}
                        style={{ width }}
                        className="block h-2 animate-pulse rounded-full bg-border-strong/50 motion-reduce:animate-none"
                    />
                ))}
            </div>
        </div>
    );
}

/**
 * A section that did not produce a result.
 *
 * Deliberately the quietest block in the rail. It is neither a pass nor an
 * alarm, and the reason is shown because "we did not measure this" without a
 * cause is indistinguishable from a bug.
 */
function NotMeasured({ failure }: { failure: SectionFailure | undefined }) {
    const reason = typeof failure?.reason === 'string' && failure.reason.length > 0 ? failure.reason : 'No reason was recorded.';

    return (
        <div className="flex items-start gap-2.5 rounded-lg border border-border-subtle bg-surface-sunken px-3 py-2.5">
            <MinusCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.75} aria-hidden="true" />
            <div className="min-w-0">
                <p className="text-[12px] font-medium text-text-secondary">Not measured</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-muted">
                    {failure?.timedOut === true ? 'Ran out of its time budget. ' : ''}
                    {reason}
                </p>
            </div>
        </div>
    );
}

function MeasuredOnly() {
    return (
        <p className="rounded-lg border border-dashed border-border-subtle px-3 py-2.5 text-[11.5px] leading-relaxed text-text-muted">
            Measured. The numbers behind this section are in the full report.
        </p>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0">
            <dt className="text-[10.5px] uppercase tracking-wider text-text-muted">{label}</dt>
            <dd className="mt-0.5 truncate font-mono text-[12.5px] tabular-nums text-text-primary">{value}</dd>
        </div>
    );
}

function StatRow({ children }: { children: ReactNode }) {
    return <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">{children}</dl>;
}

// ============= PER-SECTION MEASUREMENTS =============

function SecurityMeasurements({ data }: { data: SecurityAnalysis }) {
    const score = asFinite(data.score);
    const issues = asList(data.issues).length;

    return (
        <StatRow>
            {score !== null && <Stat label="Scan score" value={String(Math.round(score))} />}
            <Stat label="Issues raised" value={String(issues)} />
        </StatRow>
    );
}

function ParallelMeasurements({ data }: { data: ParallelAnalysisResult }) {
    const score = asFinite(data.score);
    const total = asFinite(data.totalFunctions) ?? 0;
    const parallelizable = asFinite(data.parallelizableFunctions) ?? 0;
    const hotspots = asList(data.hotspots);

    return (
        <div className="space-y-3">
            {typeof data.headline === 'string' && data.headline.length > 0 && (
                <p className="text-[12.5px] leading-relaxed text-text-secondary">{data.headline}</p>
            )}

            <StatRow>
                {score !== null && (
                    <Stat label="Parallel score" value={`${Math.round(score)}${typeof data.grade === 'string' ? ` ${data.grade}` : ''}`} />
                )}
                <Stat label="Can run together" value={`${parallelizable} of ${total}`} />
                <Stat label="Contended slots" value={String(hotspots.length)} />
            </StatRow>

            {hotspots.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {hotspots.slice(0, 6).map((hotspot) => (
                        <span
                            key={hotspot.variable}
                            className="rounded-md border border-border-subtle px-1.5 py-0.5 font-mono text-[11px] text-text-secondary"
                        >
                            {hotspot.variable}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function GasMeasurements({ data }: { data: GasProfile }) {
    const deploy = asFinite(data.deployment?.totalCost);
    const size = asFinite(data.contractSizeBytes);
    const limit = asFinite(data.contractSizeLimitBytes);
    const functions = asList(data.functions);
    const summary = data.summary;
    const used = size !== null && limit !== null && limit > 0 ? Math.min(100, (size / limit) * 100) : null;

    return (
        <div className="space-y-3.5">
            <StatRow>
                <Stat
                    label="Deploy gas"
                    value={deploy === null ? (data.deployment?.unbounded === true ? 'unbounded' : '-') : compactGas(deploy)}
                />
                <Stat label="Runtime size" value={size === null ? '-' : bytesText(size)} />
                <Stat label="Expensive fns" value={String(asFinite(summary?.expensive) ?? 0)} />
            </StatRow>

            {used !== null && (
                <div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-border-subtle">
                        <div
                            style={{ width: `${used}%` }}
                            className={`h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
                                used > 90 ? 'bg-red-500' : used > 70 ? 'bg-amber-500' : 'bg-accent'
                            }`}
                        />
                    </div>
                    <p className="mt-1.5 text-[11px] text-text-muted">
                        {Math.round(used)}% of the {limit === null ? 'code size' : bytesText(limit)} deploy limit
                    </p>
                </div>
            )}

            {functions.length > 0 && (
                <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
                    {functions.slice(0, 5).map((fn) => (
                        <li key={fn.signature} className="flex items-baseline justify-between gap-3 px-3 py-2">
                            <span className="truncate font-mono text-[11.5px] text-text-primary">{fn.name}</span>
                            <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-text-secondary">
                                {fn.gas === null ? 'unbounded' : compactGas(fn.gas)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function ChainFitMeasurements({ data }: { data: ChainFitReport }) {
    const chains = asList(data.chains);
    const cost = data.deployment?.cost;
    const blocked = asList(data.deployment?.blockedOn);

    return (
        <div className="space-y-3">
            {chains.length > 0 && (
                <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
                    {chains.map((chain) => (
                        <div
                            key={chain.id}
                            className={`rounded-lg border px-2.5 py-2 ${
                                chain.id === 'monad' ? 'border-accent-line bg-accent-soft' : 'border-border-subtle bg-surface-sunken'
                            }`}
                        >
                            <div className="flex items-center gap-1.5">
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: chain.accent }} />
                                <span className="truncate text-[11.5px] font-medium text-text-primary">{chain.shortName}</span>
                            </div>
                            <p className="mt-1 font-mono text-[11.5px] tabular-nums text-text-secondary">
                                {usdText(cost?.[chain.id]?.usd)}
                            </p>
                        </div>
                    ))}
                </div>
            )}

            {blocked.length > 0 && (
                <p className="text-[11.5px] leading-relaxed text-text-secondary">
                    Too large to deploy on {blocked.join(', ')}.
                </p>
            )}

            {asList(data.caveats).length > 0 && (
                <ul className="space-y-1">
                    {asList(data.caveats).slice(0, 3).map((caveat) => (
                        <li key={caveat} className="text-[11px] leading-relaxed text-text-muted">
                            {caveat}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/** Picks the renderer for a section, and handles the redacted case where `data` is absent. */
function Measurements({ kind, contract }: { kind: SectionKind; contract: ContractReport }) {
    const sections = contract.sections;
    if (sections === undefined) return null;

    if (kind === 'security') {
        const section = sections.security;
        if (section?.status !== 'ok') return null;
        const data: SecurityAnalysis | undefined = section.data;
        return data === undefined ? <MeasuredOnly /> : <SecurityMeasurements data={data} />;
    }

    if (kind === 'parallel') {
        const section = sections.parallel;
        if (section?.status !== 'ok') return null;
        const data: ParallelAnalysisResult | undefined = section.data;
        return data === undefined ? <MeasuredOnly /> : <ParallelMeasurements data={data} />;
    }

    if (kind === 'gas') {
        const section = sections.gas;
        if (section?.status !== 'ok') return null;
        const data: GasProfile | undefined = section.data;
        return data === undefined ? <MeasuredOnly /> : <GasMeasurements data={data} />;
    }

    const section = sections.chainfit;
    if (section?.status !== 'ok') return null;
    const data: ChainFitReport | undefined = section.data;
    return data === undefined ? <MeasuredOnly /> : <ChainFitMeasurements data={data} />;
}

// ============= CONTRACT GROUPS =============

interface ContractGroup {
    contract: ContractReport;
    findings: Finding[];
    status: 'pending' | 'ok' | 'failed';
    failure: SectionFailure | undefined;
}

function GroupBody({
    group,
    kind,
    report,
    entitled,
    onApplyPatch,
    onUnlock,
}: {
    group: ContractGroup;
    kind: SectionKind;
    report: RepoReport;
    entitled: boolean;
    onApplyPatch?: (finding: Finding) => void;
    onUnlock: () => void;
}) {
    if (group.status === 'pending') {
        return <PendingBody note={`Measuring ${SECTION_LABELS[kind].toLowerCase()}`} />;
    }

    if (group.status === 'failed') {
        return <NotMeasured failure={group.failure} />;
    }

    return (
        <div className="space-y-3.5">
            <Measurements kind={kind} contract={group.contract} />

            {group.findings.length === 0 ? (
                <p className="text-[12px] leading-relaxed text-text-muted">
                    Nothing to report from this analysis.
                </p>
            ) : (
                <div className="space-y-2">
                    {group.findings.map((finding) => (
                        <FindingCard
                            key={finding.id}
                            finding={finding}
                            locked={isLocked(report, entitled, finding)}
                            onReveal={onUnlock}
                            onApplyPatch={onApplyPatch}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function ContractScore({ contract }: { contract: ContractReport }) {
    const score = asFinite(contract.health?.score);
    const grade = contract.health?.grade;

    if (score === null || grade === undefined) {
        return <span className="shrink-0 font-mono text-[11px] text-text-muted">pending</span>;
    }

    return (
        <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10.5px] font-medium leading-none ${GRADE_TONE[grade] ?? ''}`}>
            {Math.round(score)} {grade}
        </span>
    );
}

/** Multi-contract reports collapse per contract, so one bad file does not bury the rest. */
function ContractDisclosure({
    group,
    kind,
    report,
    entitled,
    onApplyPatch,
    onUnlock,
    onOpenContract,
}: {
    group: ContractGroup;
    kind: SectionKind;
    report: RepoReport;
    entitled: boolean;
    onApplyPatch?: (finding: Finding) => void;
    onUnlock: () => void;
    onOpenContract?: (contract: ContractReport) => void;
}) {
    const bodyId = useId();
    const [open, setOpen] = useState(group.findings.length > 0 || group.status === 'failed');

    return (
        <div className="overflow-hidden rounded-xl border border-border-subtle">
            <div className="flex items-center gap-1 bg-surface-sunken/60 pr-2">
                <button
                    type="button"
                    onClick={() => setOpen((value) => !value)}
                    aria-expanded={open}
                    aria-controls={bodyId}
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent motion-reduce:transition-none"
                >
                    <ChevronRight
                        className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
                        strokeWidth={2}
                        aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium text-text-primary">{group.contract.name}</span>
                        <span className="block truncate font-mono text-[10.5px] text-text-muted">{group.contract.path}</span>
                    </span>
                    {group.findings.length > 0 && (
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-muted">
                            {group.findings.length}
                        </span>
                    )}
                    <ContractScore contract={group.contract} />
                </button>

                {onOpenContract !== undefined && (
                    <button
                        type="button"
                        onClick={() => onOpenContract(group.contract)}
                        aria-label={`Open ${group.contract.path}`}
                        className="shrink-0 rounded-md p-1.5 text-text-muted transition-colors duration-150 hover:bg-surface-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
                    >
                        <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                    </button>
                )}
            </div>

            <div id={bodyId} hidden={!open} className="border-t border-border-subtle p-3">
                <GroupBody
                    group={group}
                    kind={kind}
                    report={report}
                    entitled={entitled}
                    onApplyPatch={onApplyPatch}
                    onUnlock={onUnlock}
                />
            </div>
        </div>
    );
}

const ROLLUP_STATUS_TEXT: Readonly<Record<string, string>> = {
    none: 'no contracts',
    pending: 'running',
    ok: 'measured',
    failed: 'not measured',
    mixed: 'partly measured',
};

function AnalysisSection({
    kind,
    report,
    entitled,
    onApplyPatch,
    onUnlock,
    onOpenContract,
    innerRef,
}: {
    kind: SectionKind;
    report: RepoReport;
    entitled: boolean;
    onApplyPatch?: (finding: Finding) => void;
    onUnlock: () => void;
    onOpenContract?: (contract: ContractReport) => void;
    innerRef: (element: HTMLElement | null) => void;
}) {
    // Findings are filtered once per section rather than inside the render of
    // every card, since a large repository puts hundreds of them through here on
    // each streamed update.
    const groups = useMemo<ContractGroup[]>(() => {
        return asList(report.contracts).map((contract) => {
            const section = contract.sections?.[kind];
            const status = section === undefined ? 'pending' : section.status;
            return {
                contract,
                findings: asList(contract.findings).filter((finding) => SECTION_OF_SOURCE[finding.source] === kind),
                status: status === 'ok' ? 'ok' : status === 'failed' ? 'failed' : 'pending',
                failure: section?.status === 'failed' ? section.failure : undefined,
            };
        });
    }, [report.contracts, kind]);

    const status = ROLLUP_STATUS_TEXT[rollupStatus(report, kind)] ?? null;

    return (
        <RailSection anchor={kind} label={SECTION_LABELS[kind]} status={status} innerRef={innerRef}>
            {groups.length === 0 ? (
                <p className="text-[12px] text-text-muted">No contracts were audited.</p>
            ) : groups.length === 1 ? (
                <GroupBody
                    group={groups[0]}
                    kind={kind}
                    report={report}
                    entitled={entitled}
                    onApplyPatch={onApplyPatch}
                    onUnlock={onUnlock}
                />
            ) : (
                <div className="space-y-2">
                    {groups.map((group) => (
                        <ContractDisclosure
                            key={group.contract.id}
                            group={group}
                            kind={kind}
                            report={report}
                            entitled={entitled}
                            onApplyPatch={onApplyPatch}
                            onUnlock={onUnlock}
                            onOpenContract={onOpenContract}
                        />
                    ))}
                </div>
            )}
        </RailSection>
    );
}

// ============= HEALTH SECTION =============

/**
 * What the audit went looking for.
 *
 * The threat model was being computed and discarded, which was the single
 * biggest thing wrong with this report: it is the part that separates an audit
 * from a linter, and nobody could see it. A reader who disagrees with a finding
 * can now check whether the threat behind it was framed correctly, and a clean
 * contract reads as "these five things were tested" rather than the much less
 * useful "nothing found".
 *
 * Collapsed by default. It is the most interesting thing here for someone who
 * wants it and pure noise above the findings for someone who does not.
 */
function ThreatModel({ report }: { report: RepoReport }) {
    const withThreats = asList(report.contracts).filter(
        (contract) => asList(contract.threats).length > 0,
    );
    if (withThreats.length === 0) return null;

    const total = withThreats.reduce(
        (sum, contract) => sum + asList(contract.threats).length,
        0,
    );

    return (
        <section className="border-b border-border-subtle px-5 py-4">
            <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 outline-none ring-accent-line focus-visible:ring-2">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
                        Threat model
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
                        {total} tested
                        <ChevronDown
                            size={13}
                            className="transition-transform group-open:rotate-180 motion-reduce:transition-none"
                        />
                    </span>
                </summary>

                <div className="mt-3 space-y-3.5">
                    {withThreats.map((contract) => (
                        <div key={contract.id}>
                            {withThreats.length > 1 && (
                                <p className="mb-1.5 font-mono text-[10.5px] text-text-muted">
                                    {contract.name}
                                </p>
                            )}
                            {contract.purpose !== undefined && (
                                <p className="mb-2.5 text-[12.5px] leading-relaxed text-text-secondary">
                                    {contract.purpose}
                                </p>
                            )}
                            <ul className="space-y-2">
                                {asList(contract.threats).map((threat, index) => (
                                    <li
                                        key={`${contract.id}:${index}`}
                                        className="border-l-2 border-border-strong pl-3"
                                    >
                                        <p className="text-[12.5px] font-medium text-text-primary">
                                            {threat.title}
                                        </p>
                                        <p className="mt-0.5 text-[12px] leading-relaxed text-text-muted">
                                            {threat.approach}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </details>
        </section>
    );
}

function HealthSection({
    report,
    onOpenContract,
}: {
    report: RepoReport;
    onOpenContract?: (contract: ContractReport) => void;
}) {
    const contracts = asList(report.contracts);
    const skipped = asList(report.skipped);
    const notes = asList(report.notes);
    const origin = originText(report);

    return (
        <RailSection anchor="health" label="Health" status={`${contracts.length} audited`}>
            <div className="space-y-4">
                {contracts.length > 0 && (
                    <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle">
                        {contracts.map((contract) => {
                            const row = (
                                <>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-[12.5px] font-medium text-text-primary">
                                            {contract.name}
                                        </span>
                                        <span className="block truncate font-mono text-[10.5px] text-text-muted">
                                            {contract.path}
                                        </span>
                                    </span>
                                    <ContractScore contract={contract} />
                                </>
                            );

                            return (
                                <li key={contract.id}>
                                    {onOpenContract === undefined ? (
                                        <div className="flex items-center gap-3 px-3 py-2.5">{row}</div>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => onOpenContract(contract)}
                                            className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent motion-reduce:transition-none"
                                        >
                                            {row}
                                        </button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}

                {notes.length > 0 && (
                    <ul className="space-y-1.5">
                        {notes.map((note) => (
                            <li key={note} className="flex gap-2 text-[12px] leading-relaxed text-text-secondary">
                                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-text-muted" aria-hidden="true" />
                                {note}
                            </li>
                        ))}
                    </ul>
                )}

                {skipped.length > 0 && (
                    <details className="group rounded-lg border border-border-subtle bg-surface-sunken px-3 py-2">
                        <summary className="cursor-pointer list-none text-[11.5px] text-text-muted [&::-webkit-details-marker]:hidden transition-colors duration-150 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none">
                            {skipped.length} {skipped.length === 1 ? 'file was' : 'files were'} not audited
                        </summary>
                        <ul className="mt-2 space-y-1">
                            {skipped.map((entry) => (
                                <li key={entry.path} className="flex items-baseline justify-between gap-3 text-[11px]">
                                    <span className="truncate font-mono text-text-secondary">{entry.path}</span>
                                    <span className="shrink-0 text-text-muted">
                                        {SKIP_REASON_LABELS[entry.reason] ?? entry.reason}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </details>
                )}

                {origin !== null && <p className="text-[11px] text-text-muted">{origin}</p>}
            </div>
        </RailSection>
    );
}

// ============= RUN PROGRESS =============

function RunProgress({ done, total, label }: { done: number; total: number; label: string }) {
    const safeTotal = Math.max(0, asFinite(total) ?? 0);
    const safeDone = Math.min(safeTotal, Math.max(0, asFinite(done) ?? 0));
    const percent = safeTotal > 0 ? Math.round((safeDone / safeTotal) * 100) : 0;

    return (
        <div className="shrink-0 border-b border-border-subtle bg-surface-raised px-5 py-3.5">
            <div className="flex items-baseline justify-between gap-3">
                <p aria-live="polite" className="min-w-0 truncate text-[12.5px] font-medium text-text-primary">
                    {label.length > 0 ? label : 'Running the analysis'}
                </p>
                <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-text-muted">
                    {safeDone} / {safeTotal || '?'}
                </span>
            </div>

            <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-valuetext={`${safeDone} of ${safeTotal} contracts measured`}
                className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-border-subtle"
            >
                <div
                    style={{ width: `${percent}%` }}
                    className="h-full rounded-full bg-accent transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
                />
            </div>

            <p className="mt-2 text-[11px] text-text-muted">
                Sections appear here as each one lands. What is already measured stays readable.
            </p>
        </div>
    );
}

// ============= STANDALONE STATES =============

function EmptyRail({ onRerun }: { onRerun?: () => void }) {
    return (
        <div className="flex flex-1 items-start px-5 py-6">
            <div className="max-w-xs">
                <p className="text-[12.5px] leading-relaxed text-text-secondary">
                    No report yet. Run an analysis and the security, parallel, gas and chain fit sections fill in here.
                </p>
                {onRerun !== undefined && (
                    <button
                        type="button"
                        onClick={onRerun}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white shadow-[var(--shadow-panel)] transition-opacity duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised motion-reduce:transition-none"
                    >
                        <Play className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                        Run analysis
                    </button>
                )}
            </div>
        </div>
    );
}

function ErrorRail({ message, onRerun }: { message: string; onRerun?: () => void }) {
    return (
        <div className="flex flex-1 items-start px-5 py-6">
            <div className="max-w-xs">
                <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" strokeWidth={1.75} aria-hidden="true" />
                    <h3 className="text-[12.5px] font-semibold text-text-primary">The report did not finish</h3>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-secondary">{message}</p>
                {onRerun !== undefined && (
                    <button
                        type="button"
                        onClick={onRerun}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-[12.5px] font-medium text-text-primary transition-colors duration-150 hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised motion-reduce:transition-none"
                    >
                        <RotateCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                        Try again
                    </button>
                )}
            </div>
        </div>
    );
}

/** Shown while the first contract is still compiling and no section has landed yet. */
function StartingRail() {
    return (
        <div className="space-y-5 px-5 py-5">
            {SECTION_KINDS.map((kind) => (
                <div key={kind}>
                    <SectionHeading label={SECTION_LABELS[kind]} status="waiting" />
                    <PendingBody note="Not started yet" />
                </div>
            ))}
        </div>
    );
}

// ============= THE DOCUMENT =============

function ReportDocument({
    report,
    entitled,
    onUnlock,
    unlocking,
    unlockError,
    onApplyPatch,
    onOpenContract,
    scrollRef,
    onShare,
}: {
    report: RepoReport;
    entitled: boolean;
    onUnlock: () => void;
    unlocking: boolean;
    unlockError?: string | null;
    onApplyPatch?: (finding: Finding) => void;
    onOpenContract?: (contract: ContractReport) => void;
    scrollRef: RefObject<HTMLDivElement | null>;
    onShare?: () => void;
}) {
    const [activeSection, setActiveSection] = useState<SectionKind | null>(null);
    const sectionRefs = useRef<Partial<Record<SectionKind, HTMLElement>>>({});

    const registerSection = useCallback(
        (kind: SectionKind) => (element: HTMLElement | null) => {
            if (element === null) delete sectionRefs.current[kind];
            else sectionRefs.current[kind] = element;
        },
        [],
    );

    const jump = useCallback((kind: SectionKind) => {
        const element = sectionRefs.current[kind];
        if (element === undefined) return;

        const reduced =
            typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        element.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
        setActiveSection(kind);
    }, []);

    // Re-armed whenever the report changes, because streaming adds and removes
    // sections underneath the observer and a stale target stops reporting.
    useEffect(() => {
        const root = scrollRef.current;
        if (root === null || typeof IntersectionObserver === 'undefined') return;

        const observer = new IntersectionObserver(
            (entries) => {
                const topmost = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
                if (topmost === undefined) return;

                const anchor = topmost.target.getAttribute('data-section');
                if (anchor !== null && isSectionKind(anchor)) setActiveSection(anchor);
            },
            { root, rootMargin: '-160px 0px -55% 0px', threshold: 0 },
        );

        for (const kind of SECTION_KINDS) {
            const element = sectionRefs.current[kind];
            if (element !== undefined) observer.observe(element);
        }

        return () => observer.disconnect();
    }, [report, scrollRef]);

    const summary = useMemo(() => summariseLocked(report), [report]);
    const showUnlock = !entitled || report.redacted;

    return (
        <>
            <ScoreStrip
                report={report}
                activeSection={activeSection}
                onJump={jump}
                {...(onShare !== undefined ? { onShare } : {})}
            />

            <HealthSection report={report} onOpenContract={onOpenContract} />

            <ThreatModel report={report} />

            {SECTION_KINDS.map((kind) => (
                <AnalysisSection
                    key={kind}
                    kind={kind}
                    report={report}
                    entitled={entitled}
                    onApplyPatch={onApplyPatch}
                    onUnlock={onUnlock}
                    onOpenContract={onOpenContract}
                    innerRef={registerSection(kind)}
                />
            ))}

            {showUnlock && (
                <div className="border-t border-border-subtle px-5 py-5">
                    <UnlockPanel
                        report={report}
                        summary={summary}
                        onUnlock={onUnlock}
                        unlocking={unlocking}
                        error={unlockError}
                    />
                </div>
            )}
        </>
    );
}

// ============= THE RAIL =============

export function ReportRail({
    state,
    entitled,
    onUnlock,
    unlocking,
    unlockError,
    onApplyPatch,
    onRerun,
    onOpenContract,
    onShare,
}: ReportRailProps) {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const report = state.status === 'ready' ? state.report : state.status === 'running' ? state.partial : null;

    return (
        <aside aria-label="Contract report" className="flex h-full flex-col panel-surface">
            {state.status === 'running' && (
                <RunProgress done={state.done} total={state.total} label={state.label} />
            )}

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
                {state.status === 'empty' && <EmptyRail onRerun={onRerun} />}
                {state.status === 'error' && <ErrorRail message={state.message} onRerun={onRerun} />}
                {state.status === 'running' && report === null && <StartingRail />}

                {report !== null && (
                    <ReportDocument
                        report={report}
                        entitled={entitled}
                        onUnlock={onUnlock}
                        unlocking={unlocking}
                        unlockError={unlockError}
                        onApplyPatch={onApplyPatch}
                        onOpenContract={onOpenContract}
                        scrollRef={scrollRef}
                        {...(state.status === 'ready' && onShare !== undefined
                            ? { onShare }
                            : {})}
                    />
                )}
            </div>
        </aside>
    );
}

export default ReportRail;
