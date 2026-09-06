'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { sourceKeyOf, useAnalysisStore, useCachedAnalysis } from '@/lib/analysisStore';
import { ShareButton } from './ShareButton';
import { StaleNotice } from './StaleNotice';
import { Activity, X } from 'lucide-react';

import type { ParallelGraph as GraphModel } from '@/lib/parallel/graph';
import type { Entrypoint, Grade, Hotspot, ParallelAnalysisResult } from '@/lib/parallelAnalyzer';
import { ParallelGraph } from './ParallelGraph';
import { OptimizationPanel } from './OptimizationPanel';

/**
 * Parallel execution profiler.
 *
 * Reports one thing: which of a contract's transactions can run at the same
 * time on Monad, and for the ones that cannot, the storage slot responsible.
 */

type Analysis = ParallelAnalysisResult & {
    graph: GraphModel;
    priorities: string[];
    metadata: { analysisTimeMs: number; timestamp: string };
};

interface ParallelProfilerProps {
    code: string;
    onClose?: () => void;
    /** Run on mount. Used when a shared link supplies the contract. */
    autoRun?: boolean;
    /** Replaces the editor's contents with an optimised rewrite. */
    onApplyCode?: (code: string) => void;
}

type Tab = 'overview' | 'graph' | 'entrypoints' | 'optimize';

const TAB_LABELS: Record<Tab, string> = {
    overview: 'Overview',
    graph: 'Graph',
    entrypoints: 'Entrypoints',
    optimize: 'Optimize',
};

const GRADE_VAR: Record<Grade, string> = {
    A: '--contention-parallel',
    B: '--contention-parallel',
    C: '--contention-conditional',
    D: '--contention-conditional',
    F: '--contention-serial',
};

const SCOPE_VAR = {
    global: '--contention-serial',
    keyed: '--contention-conditional',
    caller: '--contention-parallel',
} as const;

const SCOPE_LABEL = {
    global: 'shared slot',
    keyed: 'keyed',
    caller: 'per caller',
} as const;

export function ParallelProfiler({ code, onClose, onApplyCode, autoRun = false }: ParallelProfilerProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<Tab>('overview');

    // The result lives in the shared store, so closing this panel to look at
    // another one does not throw the analysis away.
    const sourceKey = sourceKeyOf(code);
    const cached = useCachedAnalysis<Analysis>('parallel', sourceKey);
    const save = useAnalysisStore((state) => state.save);
    const analysis = cached.result;

    const analyze = useCallback(async (contract?: string) => {
        if (!code.trim()) {
            setError('There is nothing in the editor to analyse.');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const response = await fetch('/api/parallel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, contract, mode: 'full' }),
            });
            const data = await response.json();
            if (!data.success) throw new Error(data.error || 'Analysis failed');
            save('parallel', sourceKeyOf(code), data.analysis as Analysis, contract);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Could not analyse this contract.');
        } finally {
            setLoading(false);
        }
    }, [code, save]);

    // A shared link arrives with the contract but no result, so the analysis is
    // started once on mount. Guarded by a ref rather than a dependency list so a
    // re-render can never fire a second run.
    const started = useRef(false);
    useEffect(() => {
        if (!autoRun || started.current || code.trim().length === 0) return;
        started.current = true;
        void analyze();
    }, [autoRun, code, analyze]);

    return (
        <div className="flex h-full flex-col panel-surface">
            <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                    <Activity className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
                    <h2 className="truncate text-[14px] font-semibold text-text-primary">Parallel Execution</h2>
                    {analysis?.contract && (
                        <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[11px] text-accent">
                            {analysis.contract}
                        </span>
                    )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                    <ShareButton view="parallel" source={code} ready={analysis !== null} compact />
                    <button
                        onClick={() => analyze(analysis?.contract)}
                        disabled={loading}
                        className="rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                        {loading ? 'Analysing…' : analysis ? 'Re-run' : 'Analyze'}
                    </button>
                    {onClose && (
                        <button
                            onClick={onClose}
                            aria-label="Close profiler"
                            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-border-subtle hover:text-text-primary"
                        >
                            <X className="h-4 w-4" strokeWidth={1.75} />
                        </button>
                    )}
                </div>
            </header>

            {error && (
                <div className="mx-4 mt-3 rounded-lg border border-[var(--contention-serial-line)] bg-[var(--contention-serial-soft)] px-3 py-2 text-[12.5px] text-text-secondary">
                    {error}
                </div>
            )}

            {analysis && cached.stale && (
                <StaleNotice at={cached.at} onRerun={() => analyze(cached.contract)} busy={loading} />
            )}

            {!analysis && !loading && <EmptyState onStart={() => analyze()} />}
            {loading && <LoadingState />}

            {analysis && !loading && (
                <div className="flex min-h-0 flex-1 flex-col">
                    <ScoreHeader analysis={analysis} onSelectContract={(name) => analyze(name)} />

                    <nav className="flex shrink-0 gap-1 border-b border-border-subtle px-2">
                        {(Object.keys(TAB_LABELS) as Tab[]).map((value) => (
                            <button
                                key={value}
                                onClick={() => setTab(value)}
                                className={`relative px-3 py-2.5 text-[12.5px] font-medium transition-colors ${
                                    tab === value ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary'
                                }`}
                            >
                                {TAB_LABELS[value]}
                                {tab === value && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />}
                            </button>
                        ))}
                    </nav>

                    <div className={`min-h-0 flex-1 ${tab === 'graph' ? 'flex flex-col p-3' : 'overflow-auto p-4'}`}>
                        {tab === 'overview' && <Overview analysis={analysis} />}
                        {tab === 'graph' && (
                            <ParallelGraph graph={analysis.graph} analysisKey={`${analysis.contract}:${analysis.metadata.timestamp}`} />
                        )}
                        {tab === 'entrypoints' && <Entrypoints analysis={analysis} />}
                        {tab === 'optimize' && (
                            <OptimizationPanel
                                suggestions={analysis.suggestions}
                                code={code}
                                contract={analysis.contract}
                                onApply={onApplyCode}
                            />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function ScoreHeader({
    analysis,
    onSelectContract,
}: {
    analysis: Analysis;
    onSelectContract: (name: string) => void;
}) {
    const circumference = 2 * Math.PI * 26;
    const gradeColor = `var(${GRADE_VAR[analysis.grade]})`;

    return (
        <div className="shrink-0 border-b border-border-subtle px-4 py-4">
            <div className="flex items-center gap-4">
                <div className="relative h-16 w-16 shrink-0">
                    <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
                        <circle cx="32" cy="32" r="26" fill="none" strokeWidth="5" stroke="var(--border-subtle)" />
                        <circle
                            cx="32"
                            cy="32"
                            r="26"
                            fill="none"
                            strokeWidth="5"
                            stroke={gradeColor}
                            strokeLinecap="round"
                            strokeDasharray={`${(analysis.score / 100) * circumference} ${circumference}`}
                            style={{ transition: 'stroke-dasharray 600ms cubic-bezier(0.22, 1, 0.36, 1)' }}
                        />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-[17px] font-semibold leading-none tabular-nums text-text-primary">{analysis.score}</span>
                        <span className="mt-0.5 text-[10px] font-medium" style={{ color: gradeColor }}>
                            {analysis.grade}
                        </span>
                    </div>
                </div>

                <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-relaxed text-text-primary">{analysis.headline}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-text-muted">
                        <span>
                            <span className="tabular-nums text-text-secondary">{analysis.metrics.pairsBlocked}</span> blocked pairs
                        </span>
                        <span>
                            <span className="tabular-nums text-text-secondary">{analysis.metrics.globalSlots}</span> shared slots
                        </span>
                        <span>
                            <span className="tabular-nums text-text-secondary">{analysis.readOnlyFunctions.length}</span> view functions
                        </span>
                    </div>
                </div>
            </div>

            {analysis.availableContracts.length > 1 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-text-muted">In this file:</span>
                    {analysis.availableContracts.map((option) => (
                        <button
                            key={option.name}
                            onClick={() => onSelectContract(option.name)}
                            className={`rounded-md px-2 py-0.5 font-mono text-[11px] transition-colors ${
                                option.name === analysis.contract
                                    ? 'bg-accent-soft text-accent'
                                    : 'text-text-muted hover:bg-border-subtle hover:text-text-primary'
                            }`}
                        >
                            {option.name}
                            <span className="ml-1 opacity-60">{option.entrypoints}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function Overview({ analysis }: { analysis: Analysis }) {
    return (
        <div className="space-y-5">
            <p className="text-[13px] leading-relaxed text-text-secondary">{analysis.summary}</p>

            {analysis.priorities.length > 0 && (
                <section>
                    <SectionTitle>Do these first</SectionTitle>
                    <ol className="space-y-1.5">
                        {analysis.priorities.map((priority, index) => (
                            <li key={index} className="flex gap-2.5 text-[12.5px] leading-relaxed text-text-secondary">
                                <span className="shrink-0 tabular-nums text-text-muted">{index + 1}.</span>
                                {priority}
                            </li>
                        ))}
                    </ol>
                </section>
            )}

            {analysis.hotspots.length > 0 && (
                <section>
                    <SectionTitle>Storage under contention ({analysis.hotspots.length})</SectionTitle>
                    <div className="space-y-1.5">
                        {analysis.hotspots.map((hotspot) => (
                            <HotspotRow key={hotspot.variable} hotspot={hotspot} />
                        ))}
                    </div>
                </section>
            )}

            {analysis.notes.length > 0 && (
                <section>
                    <SectionTitle>Already fine</SectionTitle>
                    <ul className="space-y-1.5">
                        {analysis.notes.map((note, index) => (
                            <li key={index} className="flex gap-2 text-[12.5px] leading-relaxed text-text-secondary">
                                <span
                                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                                    style={{ background: 'var(--contention-parallel)' }}
                                />
                                {note}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <p className="border-t border-border-subtle pt-3 text-[11px] text-text-muted">
                Scored over {analysis.metrics.pairsTotal} entrypoint pairs, assuming even traffic across them. Analysed in{' '}
                {analysis.metadata.analysisTimeMs}ms.
            </p>
        </div>
    );
}

function HotspotRow({ hotspot }: { hotspot: Hotspot }) {
    const tone = `var(${SCOPE_VAR[hotspot.scope]})`;

    return (
        <div
            className="rounded-lg border px-3 py-2.5"
            style={{ borderColor: `var(${SCOPE_VAR[hotspot.scope]}-line)`, background: `var(${SCOPE_VAR[hotspot.scope]}-soft)` }}
        >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-mono text-[12.5px] font-medium text-text-primary">{hotspot.variable}</span>
                <span className="font-mono text-[11px] text-text-muted">{hotspot.typeText}</span>
                <span className="ml-auto text-[10.5px] font-medium uppercase tracking-wider" style={{ color: tone }}>
                    {SCOPE_LABEL[hotspot.scope]}
                </span>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">{hotspot.impact}</p>
        </div>
    );
}

function Entrypoints({ analysis }: { analysis: Analysis }) {
    return (
        <div className="space-y-4">
            <div className="space-y-2">
                {analysis.entrypoints.map((entry) => (
                    <EntrypointCard key={entry.name} entry={entry} />
                ))}
            </div>

            {analysis.readOnlyFunctions.length > 0 && (
                <section>
                    <SectionTitle>Read-only, never contended</SectionTitle>
                    <div className="flex flex-wrap gap-1.5">
                        {analysis.readOnlyFunctions.map((func) => (
                            <span
                                key={func.name}
                                className="rounded-md border border-border-subtle px-2 py-0.5 font-mono text-[11px] text-text-muted"
                            >
                                {func.name}()
                            </span>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}

function EntrypointCard({ entry }: { entry: Entrypoint }) {
    const tone =
        entry.contention === 'serial'
            ? '--contention-serial'
            : entry.contention === 'conditional'
                ? '--contention-conditional'
                : '--contention-parallel';

    return (
        <div className="rounded-xl border px-3.5 py-3" style={{ borderColor: `var(${tone}-line)` }}>
            <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[13px] font-medium text-text-primary">{entry.name}()</span>
                <span className="text-[11px] text-text-muted">{entry.visibility}</span>
                <span className="ml-auto text-[10.5px] font-medium uppercase tracking-wider" style={{ color: `var(${tone})` }}>
                    {entry.contention === 'serial' ? 'serial' : entry.contention === 'conditional' ? 'same key only' : 'parallel'}
                </span>
            </div>

            <p className="mt-1.5 text-[12px] leading-relaxed text-text-secondary">{entry.reason}</p>

            {entry.writes.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10.5px] uppercase tracking-wider text-text-muted">Writes</span>
                    {entry.writes.map((effect) => (
                        <span
                            key={effect.variable}
                            className="rounded-md px-1.5 py-0.5 font-mono text-[11px]"
                            style={{
                                background: `var(${SCOPE_VAR[effect.scope]}-soft)`,
                                color: `var(${SCOPE_VAR[effect.scope]})`,
                            }}
                        >
                            {effect.variable}
                        </span>
                    ))}
                </div>
            )}

            {entry.through.length > 0 && (
                <p className="mt-1.5 text-[11px] text-text-muted">
                    Through <span className="font-mono">{entry.through.join(', ')}</span>
                </p>
            )}
        </div>
    );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">{children}</h3>;
}

function EmptyState({ onStart }: { onStart: () => void }) {
    return (
        <div className="flex flex-1 items-center justify-center px-8">
            <div className="max-w-xs text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft">
                    <Activity className="h-5 w-5 text-accent" strokeWidth={1.5} />
                </div>
                <h3 className="text-[14px] font-semibold text-text-primary">Parallel execution analysis</h3>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-secondary">
                    Find which transactions can run at the same time on Monad, and which storage slot is stopping the rest.
                </p>
                <button
                    onClick={onStart}
                    className="mt-4 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
                >
                    Analyze contract
                </button>
            </div>
        </div>
    );
}

function LoadingState() {
    return (
        <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
                <div className="relative mx-auto h-8 w-8">
                    <div className="absolute inset-0 rounded-full border-2 border-border-subtle" />
                    <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-accent" />
                </div>
                <p className="mt-3 text-[12.5px] text-text-muted">Tracing storage dependencies…</p>
            </div>
        </div>
    );
}

export default ParallelProfiler;
