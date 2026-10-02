'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
    AlertTriangle,
    ArrowRight,
    Check,
    Download,
    ExternalLink,
    FileCode2,
    Loader2,
    RotateCw,
    Sparkles,
    X,
} from 'lucide-react';

import { optimizationToMarkdown } from '@/lib/optimize/comparison';
import type { OptimizeState } from '@/lib/optimize/useOptimize';
import type { OptimizeResult, OptimizeStage, ScoreSnapshot } from '@/lib/optimize/types';
import type { Grade, Severity } from '@/lib/report/types';
import { GRADE_TONE } from '../report/ScoreStrip';

/**
 * The optimizer, from the first second to the result.
 *
 * While it runs, the reader sees which gate the new code is at, because a
 * minute and a half with a spinner feels broken, and a minute and a half
 * watching fixes get compiled, checked and re-audited feels like work being
 * done. When it finishes, the before and after are measured by the same report,
 * so the numbers at the top are the proof and the diff underneath is the
 * evidence.
 */

const DiffEditor = dynamic(() => import('@monaco-editor/react').then((module) => module.DiffEditor), {
    ssr: false,
    loading: () => <div className="h-full animate-pulse bg-surface-sunken motion-reduce:animate-none" />,
});

const EASE = [0.16, 1, 0.3, 1] as const;

const STEPS: ReadonlyArray<{ stage: OptimizeStage; label: string }> = [
    { stage: 'rewriting', label: 'Writing fixes for each finding' },
    { stage: 'compiling', label: 'Compiling and checking every public function survives' },
    { stage: 'reporting', label: 'Re-running the full report on the new code' },
    { stage: 'saving', label: 'Saving the new report' },
];

/** Where a stage sits in the stepper. A refinement pass revisits the first three. */
function stepIndex(stage: OptimizeStage): number {
    if (stage === 'refining') return 0;
    return STEPS.findIndex((step) => step.stage === stage);
}

export interface OptimizeDialogProps {
    open: boolean;
    contractName: string;
    before: ScoreSnapshot | null;
    state: OptimizeState;
    isDark: boolean;
    onClose: () => void;
    onRetry: () => void;
    onApply: (result: OptimizeResult) => void;
    onSignIn: () => void;
    onUnlock: () => void;
    /** Free optimizations left, when known and the paywall is on. */
    freeLeft: number | null;
}

function GradeChip({ grade }: { grade: Grade | null }) {
    if (grade === null) return null;
    return (
        <span className={`rounded-md border px-1.5 py-0.5 text-[12px] font-semibold leading-none ${GRADE_TONE[grade]}`}>
            {grade}
        </span>
    );
}

function Score({ snapshot, emphasis }: { snapshot: ScoreSnapshot; emphasis: boolean }) {
    return (
        <div className="flex items-baseline gap-2">
            <span
                className={`font-display font-semibold leading-none tracking-tight tabular-nums ${
                    emphasis ? 'text-[64px] text-text-primary' : 'text-[44px] text-text-muted'
                }`}
            >
                {snapshot.score ?? '--'}
            </span>
            <GradeChip grade={snapshot.grade} />
        </div>
    );
}

const SEVERITY_ROWS: ReadonlyArray<{ key: Severity; label: string; dot: string }> = [
    { key: 'critical', label: 'Critical', dot: 'bg-red-500' },
    { key: 'high', label: 'High', dot: 'bg-orange-500' },
    { key: 'medium', label: 'Medium', dot: 'bg-amber-500' },
    { key: 'low', label: 'Low', dot: 'bg-emerald-500' },
];

function Delta({ before, after, lowerIsBetter = true, format = String }: {
    before: number | null;
    after: number | null;
    lowerIsBetter?: boolean;
    format?: (value: number) => string;
}) {
    if (before === null || after === null) return <span className="text-text-muted">n/a</span>;
    const better = lowerIsBetter ? after < before : after > before;
    const worse = lowerIsBetter ? after > before : after < before;
    return (
        <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
            <span className="text-text-muted">{format(before)}</span>
            <ArrowRight size={11} className="text-text-muted" aria-hidden />
            <span className={better ? 'font-semibold text-emerald-600 dark:text-emerald-400' : worse ? 'text-red-600 dark:text-red-400' : 'text-text-primary'}>
                {format(after)}
            </span>
        </span>
    );
}

function percentChange(before: number | null, after: number | null): string | null {
    if (before === null || after === null || before === 0) return null;
    const change = ((after - before) / before) * 100;
    if (Math.abs(change) < 0.05) return null;
    return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
}

function save(contents: string, fileName: string, type: string): void {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}

function downloadSource(result: OptimizeResult): void {
    const name = result.path.split('/').pop() ?? 'Contract.sol';
    save(result.optimized, name.replace(/\.sol$/i, '.optimized.sol'), 'text/plain');
}

/** Scores, changes, the diff and both versions of the contract, in one file. */
function downloadComparison(result: OptimizeResult): void {
    const name = (result.path.split('/').pop() ?? 'Contract.sol').replace(/\.sol$/i, '');
    const markdown = optimizationToMarkdown(result, { after: `${window.location.origin}/report/${result.reportId}` });
    save(markdown, `monsmith-${name.toLowerCase()}-before-and-after.md`, 'text/markdown');
}

function Running({ state, before, contractName }: {
    state: Extract<OptimizeState, { status: 'running' }>;
    before: ScoreSnapshot | null;
    contractName: string;
}) {
    const reduce = useReducedMotion();
    const active = stepIndex(state.stage);

    return (
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-10">
            <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">
                    <Sparkles size={18} aria-hidden />
                </span>
                <div>
                    <h2 className="font-display text-[20px] font-semibold tracking-tight text-text-primary">
                        Optimizing {contractName}
                    </h2>
                    <p className="text-[12.5px] text-text-secondary">
                        Usually about a minute and a half. Every change is compiled and re-audited before you see it.
                    </p>
                </div>
            </div>

            <ol className="mt-8 space-y-1">
                {STEPS.map((step, index) => {
                    const done = index < active;
                    const current = index === active;
                    return (
                        <li
                            key={step.stage}
                            className={`flex items-start gap-3 rounded-xl px-3 py-3 transition-colors duration-300 ${current ? 'bg-surface-raised shadow-[var(--shadow-panel)]' : ''}`}
                        >
                            <span
                                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                                    done
                                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                        : current
                                          ? 'border-accent-line bg-accent-soft text-accent'
                                          : 'border-border-subtle text-text-muted'
                                }`}
                            >
                                {done ? (
                                    <Check size={11} strokeWidth={3} aria-hidden />
                                ) : current ? (
                                    <Loader2 size={11} className="animate-spin motion-reduce:animate-none" aria-hidden />
                                ) : (
                                    <span className="text-[10px] font-semibold">{index + 1}</span>
                                )}
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className={`text-[13.5px] ${current ? 'font-medium text-text-primary' : done ? 'text-text-secondary' : 'text-text-muted'}`}>
                                    {step.label}
                                </p>
                                {current && (
                                    <motion.p
                                        key={state.label}
                                        initial={reduce ? false : { opacity: 0, y: 2 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.25, ease: EASE }}
                                        aria-live="polite"
                                        className="mt-0.5 text-[12px] text-text-muted"
                                    >
                                        {state.stage === 'refining' ? `Second look at what is left. ${state.label}` : state.label}
                                    </motion.p>
                                )}
                                {current && state.stage === 'reporting' && state.progress !== null && state.progress.total > 0 && (
                                    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border-subtle">
                                        <div
                                            className="h-full rounded-full bg-accent transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
                                            style={{ width: `${Math.round((state.progress.done / state.progress.total) * 100)}%` }}
                                        />
                                    </div>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ol>

            {before !== null && (
                <div className="mt-8 flex items-center gap-4 rounded-xl border border-border-subtle bg-surface-sunken px-4 py-3">
                    <span className="text-[12px] text-text-muted">Current score</span>
                    <span className="font-display text-[22px] font-semibold tabular-nums text-text-primary">{before.score ?? '--'}</span>
                    <GradeChip grade={before.grade} />
                    <ArrowRight size={14} className="text-text-muted" aria-hidden />
                    <span className="text-[12px] text-text-muted">measured again when the fixes are in</span>
                </div>
            )}
        </div>
    );
}

function Result({ result, isDark, onApply, onClose, freeLeft }: {
    result: OptimizeResult;
    isDark: boolean;
    onApply: (result: OptimizeResult) => void;
    onClose: () => void;
    freeLeft: number | null;
}) {
    const reduce = useReducedMotion();
    const gain = result.after.score !== null && result.before.score !== null ? result.after.score - result.before.score : null;
    const gasChange = percentChange(result.before.deployGas, result.after.deployGas);

    const releaseAmdLoader = useCallback(() => {
        const amdDefine = (window as unknown as { define?: { amd?: unknown } }).define;
        if (amdDefine?.amd !== undefined) delete amdDefine.amd;
    }, []);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* The proof */}
            <section className="border-b border-border-subtle px-6 py-6">
                <div className="flex flex-wrap items-center gap-x-10 gap-y-5">
                    <div className="flex items-center gap-6">
                        <div>
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">Before</p>
                            <Score snapshot={result.before} emphasis={false} />
                        </div>
                        <ArrowRight size={22} className="mt-6 text-text-muted" aria-hidden />
                        <div>
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">After</p>
                            <motion.div
                                initial={reduce ? false : { scale: 0.92, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ duration: 0.5, ease: EASE }}
                            >
                                <Score snapshot={result.after} emphasis />
                            </motion.div>
                        </div>
                        {gain !== null && gain > 0 && (
                            <span className="mt-6 rounded-full bg-emerald-500/15 px-3 py-1 font-mono text-[14px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                                +{gain}
                            </span>
                        )}
                    </div>

                    <dl className="grid flex-1 grid-cols-2 gap-x-8 gap-y-2 text-[12.5px] sm:grid-cols-3">
                        {SEVERITY_ROWS.map((row) => (
                            <div key={row.key} className="flex items-center justify-between gap-3">
                                <dt className="flex items-center gap-1.5 text-text-secondary">
                                    <span className={`h-1.5 w-1.5 rounded-full ${row.dot}`} aria-hidden />
                                    {row.label}
                                </dt>
                                <dd>
                                    <Delta before={result.before.counts[row.key]} after={result.after.counts[row.key]} />
                                </dd>
                            </div>
                        ))}
                        <div className="flex items-center justify-between gap-3">
                            <dt className="text-text-secondary">Deploy gas</dt>
                            <dd className="flex items-center gap-1.5">
                                <Delta
                                    before={result.before.deployGas}
                                    after={result.after.deployGas}
                                    format={(value) => `${Math.round(value / 1000)}k`}
                                />
                                {gasChange !== null && <span className="text-[11px] text-text-muted">{gasChange}</span>}
                            </dd>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <dt className="text-text-secondary">Parallel score</dt>
                            <dd>
                                <Delta before={result.before.parallelScore} after={result.after.parallelScore} lowerIsBetter={false} />
                            </dd>
                        </div>
                    </dl>
                </div>

                {!result.improved && (
                    <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2 text-[12.5px] text-text-secondary">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                        These changes did not raise the score when the report ran again, so this optimization was not counted
                        against your free ones. The diff is still here if any change is useful to you.
                    </p>
                )}
            </section>

            {/* The evidence */}
            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(280px,360px)_1fr]">
                <section aria-label="What changed" className="min-h-0 overflow-y-auto border-b border-border-subtle px-5 py-5 lg:border-b-0 lg:border-r">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                        {result.changes.length} {result.changes.length === 1 ? 'change' : 'changes'} · +{result.lines.added} −{result.lines.removed} lines
                    </p>
                    <ol className="mt-3 space-y-2.5">
                        {result.changes.map((change, index) => (
                            <li key={`${change.title}-${index}`} className="rounded-xl border border-border-subtle bg-surface-raised p-3">
                                <p className="text-[13px] font-medium text-text-primary">{change.title}</p>
                                {change.why.length > 0 && (
                                    <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">{change.why}</p>
                                )}
                                {change.fixes.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        {change.fixes.map((fix) => (
                                            <span key={fix} className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                                                <Check size={10} strokeWidth={3} aria-hidden />
                                                {fix}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </li>
                        ))}
                    </ol>
                </section>

                <section aria-label="The diff" className="flex min-h-[360px] flex-col">
                    <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2 text-[12px] text-text-muted">
                        <FileCode2 size={13} aria-hidden />
                        <span className="truncate font-mono">{result.path}</span>
                        <span className="ml-auto">Original left, optimized right</span>
                    </div>
                    <div className="min-h-0 flex-1">
                        <DiffEditor
                            original={result.original}
                            modified={result.optimized}
                            language="sol"
                            theme={isDark ? 'vs-dark' : 'light'}
                            onMount={releaseAmdLoader}
                            options={{
                                readOnly: true,
                                renderSideBySide: true,
                                minimap: { enabled: false },
                                fontSize: 12.5,
                                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                                scrollBeyondLastLine: false,
                                hideUnchangedRegions: { enabled: true },
                            }}
                        />
                    </div>
                </section>
            </div>

            <footer className="flex flex-wrap items-center gap-3 border-t border-border-subtle bg-surface-raised px-6 py-3.5">
                <button
                    type="button"
                    onClick={() => onApply(result)}
                    className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white outline-none ring-accent-line ring-offset-2 ring-offset-surface-raised transition-opacity hover:opacity-90 focus-visible:ring-2"
                >
                    <Check size={14} aria-hidden />
                    Apply to the editor
                </button>
                <button
                    type="button"
                    onClick={() => downloadComparison(result)}
                    title="Scores before and after, every change and why, the diff, and both versions of the contract"
                    className="inline-flex items-center gap-2 rounded-lg border border-accent-line bg-accent-soft px-3.5 py-2 text-[12.5px] font-medium text-accent outline-none ring-accent-line transition-colors hover:border-accent focus-visible:ring-2"
                >
                    <Download size={13} aria-hidden />
                    Download before and after
                </button>
                <button
                    type="button"
                    onClick={() => downloadSource(result)}
                    className="inline-flex items-center gap-2 rounded-lg border border-border-subtle px-3.5 py-2 text-[12.5px] font-medium text-text-secondary outline-none ring-accent-line transition-colors hover:border-border-strong hover:text-text-primary focus-visible:ring-2"
                >
                    <Download size={13} aria-hidden />
                    Download .sol
                </button>
                <a
                    href={`/report/${result.reportId}`}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-2 rounded-lg border border-border-subtle px-3.5 py-2 text-[12.5px] font-medium text-text-secondary outline-none ring-accent-line transition-colors hover:border-border-strong hover:text-text-primary focus-visible:ring-2"
                >
                    <ExternalLink size={13} aria-hidden />
                    Open the new report
                </a>
                <p className="ml-auto text-[12px] text-text-muted">
                    {result.free
                        ? freeLeft === null
                            ? 'This used one of your free optimizations.'
                            : `This used one of your free optimizations. ${freeLeft} left.`
                        : ''}
                </p>
                <button type="button" onClick={onClose} className="rounded text-[12.5px] text-text-muted outline-none ring-accent-line hover:text-text-primary focus-visible:ring-2">
                    Close
                </button>
            </footer>
        </div>
    );
}

function Failed({ state, onRetry, onSignIn, onUnlock, onClose }: {
    state: Extract<OptimizeState, { status: 'error' }>;
    onRetry: () => void;
    onSignIn: () => void;
    onUnlock: () => void;
    onClose: () => void;
}) {
    const primary =
        state.reason === 'sign-in'
            ? { label: 'Sign in free', action: onSignIn }
            : state.reason === 'pay'
              ? { label: 'Unlock this report', action: onUnlock }
              : { label: 'Try again', action: onRetry };

    return (
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-10 text-center">
            <span className={`grid h-11 w-11 place-items-center rounded-xl ${state.reason === null ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-accent-soft text-accent'}`}>
                {state.reason === null ? <AlertTriangle size={18} aria-hidden /> : <Sparkles size={18} aria-hidden />}
            </span>
            <p className="mt-4 text-[14px] leading-relaxed text-text-primary">{state.message}</p>
            <div className="mt-6 flex items-center gap-3">
                <button
                    type="button"
                    onClick={primary.action}
                    className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white outline-none ring-accent-line ring-offset-2 ring-offset-background transition-opacity hover:opacity-90 focus-visible:ring-2"
                >
                    {state.reason === null && <RotateCw size={13} aria-hidden />}
                    {primary.label}
                </button>
                <button type="button" onClick={onClose} className="rounded text-[12.5px] text-text-muted outline-none ring-accent-line hover:text-text-primary focus-visible:ring-2">
                    Close
                </button>
            </div>
        </div>
    );
}

export function OptimizeDialog({
    open,
    contractName,
    before,
    state,
    isDark,
    onClose,
    onRetry,
    onApply,
    onSignIn,
    onUnlock,
    freeLeft,
}: OptimizeDialogProps) {
    const reduce = useReducedMotion();
    const closeRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            // A running optimization is not dismissed by a stray Escape.
            if (event.key === 'Escape' && state.status !== 'running') onClose();
        };
        window.addEventListener('keydown', onKey);
        closeRef.current?.focus();
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose, state.status]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    role="dialog"
                    aria-modal="true"
                    aria-label={`Optimize ${contractName}`}
                    initial={reduce ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: EASE }}
                    className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/40 p-0 backdrop-blur-sm sm:p-6"
                >
                    <motion.div
                        initial={reduce ? false : { opacity: 0, y: 16, scale: 0.985 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 16, scale: 0.985 }}
                        transition={{ duration: 0.3, ease: EASE }}
                        className="relative flex w-full max-w-7xl flex-col overflow-hidden bg-background shadow-2xl sm:rounded-2xl sm:border sm:border-border-subtle"
                    >
                        <button
                            ref={closeRef}
                            type="button"
                            onClick={onClose}
                            aria-label={state.status === 'running' ? 'Stop and close' : 'Close'}
                            title={state.status === 'running' ? 'Stop and close. Nothing is charged.' : 'Close'}
                            className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-lg text-text-muted outline-none ring-accent-line transition-colors hover:bg-surface-sunken hover:text-text-primary focus-visible:ring-2"
                        >
                            <X size={16} />
                        </button>

                        {state.status === 'running' && <Running state={state} before={before} contractName={contractName} />}
                        {state.status === 'done' && (
                            <Result result={state.result} isDark={isDark} onApply={onApply} onClose={onClose} freeLeft={freeLeft} />
                        )}
                        {state.status === 'error' && (
                            <Failed state={state} onRetry={onRetry} onSignIn={onSignIn} onUnlock={onUnlock} onClose={onClose} />
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
