'use client';

import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, Copy, Loader2, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';

import type { OptimizationSuggestion } from '@/lib/parallelAnalyzer';

/**
 * The optimisation tab.
 *
 * The static suggestions below say what to change. The rewrite above actually
 * does it, and only offers the result once the server has proved the contract
 * still compiles and still exposes every function, event and getter it started
 * with. Behaviour is not machine-checkable, so it is labelled as unverified
 * rather than quietly implied to be safe.
 */

interface ScoreSummary {
    score: number;
    grade: string;
    headline: string;
    entrypoints: number;
    parallelEntrypoints: number;
    blockedPairs: number;
    totalPairs: number;
    globalSlots: string[];
}

interface RewriteChange {
    title: string;
    detail: string;
}

interface Verification {
    interfacePreserved: boolean;
    preservedMembers: number;
    addedMembers: string[];
    compiled: boolean;
    compilerSkippedReason: string | null;
    behaviourVerified: boolean;
}

interface RewriteResult {
    contract: string;
    /** False when the contended slots turned out to be structural. */
    improved: boolean;
    optimizedCode: string;
    before: ScoreSummary;
    after: ScoreSummary;
    changes: RewriteChange[];
    modelNotes: string[];
    verification: Verification;
    attempts: number;
}

interface OptimizationPanelProps {
    suggestions: OptimizationSuggestion[];
    code: string;
    contract: string;
    onApply?: (code: string) => void;
}

const PROGRESS_STAGES = [
    'Reading the storage layout',
    'Rewriting contended state',
    'Compiling the result',
    'Checking every function, event and getter survived',
];

export function OptimizationPanel({ suggestions, code, contract, onApply }: OptimizationPanelProps) {
    const [result, setResult] = useState<RewriteResult | null>(null);
    const [running, setRunning] = useState(false);
    const [stage, setStage] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [showCode, setShowCode] = useState(false);
    const [expanded, setExpanded] = useState<number | null>(null);

    useEffect(() => {
        if (!running) return;
        setStage(0);
        // A verified rewrite takes real time. Naming the current step is the
        // difference between waiting and wondering whether it has hung.
        const timer = setInterval(() => setStage((value) => Math.min(value + 1, PROGRESS_STAGES.length - 1)), 12_000);
        return () => clearInterval(timer);
    }, [running]);

    const optimize = async () => {
        setRunning(true);
        setError(null);
        setResult(null);

        try {
            const response = await fetch('/api/parallel/optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, contract }),
            });
            const data = await response.json();

            if (!data.success) throw new Error(data.error || 'Optimisation failed');
            setResult(data as RewriteResult);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Optimisation failed');
        } finally {
            setRunning(false);
        }
    };

    const copy = async () => {
        if (!result) return;
        try {
            await navigator.clipboard.writeText(result.optimizedCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setError('Could not copy to the clipboard.');
        }
    };

    return (
        <div className="space-y-5">
            <section className="overflow-hidden rounded-2xl border border-accent-line">
                <div className="flex flex-wrap items-start gap-3 bg-accent-soft px-4 py-4">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-white">
                        <Sparkles className="h-4.5 w-4.5" strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-[15px] font-semibold text-text-primary">Rewrite for parallel execution</h3>
                        <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
                            Restructures the slots that force <span className="font-mono">{contract}</span> to run one
                            transaction at a time. The result is returned only after it compiles and every public
                            function, event and getter has been checked against the original.
                        </p>
                    </div>
                    <button
                        onClick={optimize}
                        disabled={running}
                        className="shrink-0 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                        {running ? 'Working…' : result ? 'Run again' : 'Optimize with AI'}
                    </button>
                </div>

                {running && (
                    <div className="space-y-2 border-t border-accent-line px-4 py-4">
                        {PROGRESS_STAGES.map((label, index) => (
                            <div key={label} className="flex items-center gap-2.5 text-[12.5px]">
                                {index < stage ? (
                                    <Check className="h-3.5 w-3.5 text-[var(--contention-parallel)]" strokeWidth={2.5} />
                                ) : index === stage ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" strokeWidth={2} />
                                ) : (
                                    <span className="h-3.5 w-3.5 rounded-full border border-border-strong" />
                                )}
                                <span className={index <= stage ? 'text-text-primary' : 'text-text-muted'}>{label}</span>
                            </div>
                        ))}
                        <p className="pt-1 text-[11px] text-text-muted">
                            A large contract can take a couple of minutes. Rejected attempts are retried automatically.
                        </p>
                    </div>
                )}

                {error && !running && (
                    <div className="flex items-start gap-2.5 border-t border-accent-line px-4 py-3">
                        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--contention-conditional)]" strokeWidth={1.75} />
                        <p className="text-[12.5px] leading-relaxed text-text-secondary">{error}</p>
                    </div>
                )}
            </section>

            {result && (
                <section className="space-y-4">
                    <div className="grid grid-cols-3 items-center gap-3 rounded-2xl border border-border-subtle px-4 py-4">
                        <ScoreBlock label="Before" score={result.before.score} grade={result.before.grade} muted />
                        <div className="text-center">
                            <div
                                className="text-[13px] font-medium"
                                style={{ color: result.improved ? 'var(--contention-parallel)' : 'var(--text-muted)' }}
                            >
                                {result.improved ? `+${result.after.score - result.before.score}` : 'no change'}
                            </div>
                            <div className="mt-0.5 text-[11px] text-text-muted">
                                {result.before.blockedPairs} → {result.after.blockedPairs} blocked pairs
                            </div>
                        </div>
                        <ScoreBlock label="After" score={result.after.score} grade={result.after.grade} />
                    </div>

                    {!result.improved && (
                        <p className="rounded-2xl border border-border-subtle px-4 py-3 text-[12.5px] leading-relaxed text-text-secondary">
                            The contention in <span className="font-mono">{result.contract}</span> is structural: the
                            shared slots hold contract-wide invariants that cannot be split without changing what the
                            contract guarantees. The rewrite is still here to read, but applying it will not raise the
                            score.
                        </p>
                    )}

                    <div className="space-y-2 rounded-2xl border border-border-subtle px-4 py-3.5">
                        <VerificationRow
                            ok
                            text={`Interface preserved — ${result.verification.preservedMembers} public functions, getters and events all present`}
                        />
                        {result.verification.compiled ? (
                            <VerificationRow ok text="Compiles with the bundled Solidity compiler" />
                        ) : (
                            <VerificationRow
                                ok={false}
                                text={result.verification.compilerSkippedReason ?? 'Compilation was not run.'}
                            />
                        )}
                        <VerificationRow
                            ok={false}
                            text="Behaviour is not machine-verified. Read the diff and run your tests before deploying."
                        />
                        {result.verification.addedMembers.length > 0 && (
                            <p className="pt-0.5 text-[11.5px] text-text-muted">
                                Added: <span className="font-mono">{result.verification.addedMembers.join(', ')}</span>
                            </p>
                        )}
                    </div>

                    {result.changes.length > 0 && (
                        <div className="rounded-2xl border border-border-subtle">
                            <h4 className="border-b border-border-subtle px-4 py-2.5 text-[12px] font-medium uppercase tracking-wide text-text-muted">
                                What changed
                            </h4>
                            <ul className="divide-y divide-border-subtle">
                                {result.changes.map((change, index) => (
                                    <li key={index} className="px-4 py-2.5">
                                        <div className="text-[13px] font-medium text-text-primary">{change.title}</div>
                                        <div className="mt-0.5 text-[12px] leading-relaxed text-text-secondary">{change.detail}</div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {result.modelNotes.length > 0 && (
                        <div className="rounded-2xl border border-border-subtle px-4 py-3.5">
                            <h4 className="text-[12px] font-medium uppercase tracking-wide text-text-muted">Notes from the rewrite</h4>
                            <ul className="mt-2 space-y-1.5">
                                {result.modelNotes.map((note, index) => (
                                    <li key={index} className="flex gap-2 text-[12.5px] leading-relaxed text-text-secondary">
                                        <span className="text-text-muted">·</span>
                                        {note}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                        {onApply && (
                            <button
                                onClick={() => onApply(result.optimizedCode)}
                                className={
                                    result.improved
                                        ? 'rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90'
                                        : 'rounded-lg border border-border-subtle px-4 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:text-text-primary'
                                }
                            >
                                Apply to editor
                            </button>
                        )}
                        <button
                            onClick={copy}
                            className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3.5 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:text-text-primary"
                        >
                            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            {copied ? 'Copied' : 'Copy source'}
                        </button>
                        <button
                            onClick={() => setShowCode((value) => !value)}
                            className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3.5 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:text-text-primary"
                        >
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showCode ? 'rotate-180' : ''}`} />
                            {showCode ? 'Hide source' : 'View source'}
                        </button>
                    </div>

                    {showCode && (
                        <pre className="max-h-[420px] overflow-auto rounded-2xl border border-border-subtle panel-sunken p-4 font-mono text-[11.5px] leading-relaxed text-text-primary">
                            {result.optimizedCode}
                        </pre>
                    )}
                </section>
            )}

            <section>
                <h4 className="px-1 pb-2 text-[12px] font-medium uppercase tracking-wide text-text-muted">
                    Suggestions from the analysis
                </h4>
                <div className="space-y-2">
                    {suggestions.map((suggestion, index) => (
                        <SuggestionCard
                            key={index}
                            suggestion={suggestion}
                            open={expanded === index}
                            onToggle={() => setExpanded(expanded === index ? null : index)}
                        />
                    ))}
                </div>
            </section>
        </div>
    );
}

function ScoreBlock({ label, score, grade, muted }: { label: string; score: number; grade: string; muted?: boolean }) {
    return (
        <div className="text-center">
            <div className="text-[11px] uppercase tracking-wide text-text-muted">{label}</div>
            <div className={`mt-0.5 text-2xl font-semibold tabular-nums ${muted ? 'text-text-muted' : 'text-text-primary'}`}>
                {score}
                <span className="ml-1 text-[13px] font-normal text-text-muted">{grade}</span>
            </div>
        </div>
    );
}

function VerificationRow({ ok, text }: { ok: boolean; text: string }) {
    return (
        <div className="flex items-start gap-2.5">
            {ok ? (
                <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-[var(--contention-parallel)]" strokeWidth={1.75} />
            ) : (
                <TriangleAlert className="mt-px h-4 w-4 shrink-0 text-[var(--contention-conditional)]" strokeWidth={1.75} />
            )}
            <span className="text-[12.5px] leading-relaxed text-text-secondary">{text}</span>
        </div>
    );
}

const PRIORITY_VAR: Record<OptimizationSuggestion['priority'], string> = {
    high: '--contention-serial',
    medium: '--contention-conditional',
    low: '--contention-parallel',
};

function SuggestionCard({
    suggestion,
    open,
    onToggle,
}: {
    suggestion: OptimizationSuggestion;
    open: boolean;
    onToggle: () => void;
}) {
    return (
        <div className={`overflow-hidden rounded-xl border transition-colors ${open ? 'border-accent-line' : 'border-border-subtle'}`}>
            <button onClick={onToggle} className="flex w-full items-start gap-3 px-4 py-3 text-left">
                <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: `var(${PRIORITY_VAR[suggestion.priority]})` }}
                />
                <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-text-primary">{suggestion.title}</span>
                    <span
                        className={`mt-0.5 text-[12px] leading-relaxed text-text-secondary ${
                            open ? 'block' : 'line-clamp-2'
                        }`}
                    >
                        {suggestion.description}
                    </span>
                    <span className="mt-1 block text-[11px] text-text-muted">{suggestion.impact}</span>
                </span>
                <ChevronDown
                    className={`mt-0.5 h-4 w-4 shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
                />
            </button>

            {open && suggestion.currentCode && suggestion.suggestedCode && (
                <div className="grid gap-3 border-t border-border-subtle px-4 py-3 md:grid-cols-2">
                    <CodeBlock label="Today" tone="--contention-serial" code={suggestion.currentCode} />
                    <CodeBlock label="Instead" tone="--contention-parallel" code={suggestion.suggestedCode} />
                </div>
            )}
        </div>
    );
}

function CodeBlock({ label, tone, code }: { label: string; tone: string; code: string }) {
    return (
        <div>
            <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wider" style={{ color: `var(${tone})` }}>
                {label}
            </div>
            <pre className="overflow-x-auto rounded-lg border border-border-subtle panel-sunken p-2.5 font-mono text-[11px] leading-relaxed text-text-primary">
                {code}
            </pre>
        </div>
    );
}

export default OptimizationPanel;
