'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, FileCode2, RotateCw } from 'lucide-react';

/**
 * Every audit Monsmith has attested, newest first, read through Envio.
 *
 * Hidden when the deployment has no ledger configured, so a missing setting
 * never shows as an empty box. A failed read says so and offers a retry,
 * because an empty list would read as "nothing has been audited".
 */

interface Entry {
    sourceHash: string;
    auditedChainId: number;
    target: string;
    score: number;
    critical: number;
    high: number;
    reportURI: string;
    reattested: boolean;
    timestamp: number;
    txHash: string;
}

interface LedgerResponse {
    via: 'envio-hyperindex' | 'envio-hypersync';
    stats: {
        attestations: number;
        sources: number;
        deployments: number;
        averageScore: number | null;
        criticalFound: number;
        highFound: number;
    };
    recent: Entry[];
    contractUrl: string;
    explorer: string;
    error?: string;
}

type State = { kind: 'loading' } | { kind: 'off' } | { kind: 'error' } | { kind: 'ready'; ledger: LedgerResponse };

const ZERO = '0x0000000000000000000000000000000000000000';

function short(hex: string): string {
    return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

function ago(seconds: number): string {
    if (seconds <= 0) return '';
    const delta = Math.max(0, Date.now() / 1000 - seconds);
    if (delta < 90) return 'just now';
    if (delta < 5400) return `${Math.round(delta / 60)} min ago`;
    if (delta < 129_600) return `${Math.round(delta / 3600)} h ago`;
    return `${Math.round(delta / 86_400)} d ago`;
}

function tone(score: number): string {
    if (score >= 75) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    if (score >= 50) return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
    return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300';
}

export function LedgerFeed() {
    const [state, setState] = useState<State>({ kind: 'loading' });
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        fetch('/api/attestations', { signal: controller.signal })
            .then(async (response) => {
                if (response.status === 503) return setState({ kind: 'off' });
                if (!response.ok) return setState({ kind: 'error' });
                setState({ kind: 'ready', ledger: (await response.json()) as LedgerResponse });
            })
            .catch((error: unknown) => {
                if (error instanceof DOMException && error.name === 'AbortError') return;
                setState({ kind: 'error' });
            });
        return () => controller.abort();
    }, [attempt]);

    if (state.kind === 'off') return null;

    return (
        <section aria-labelledby="ledger-heading" className="mt-12">
            <div className="flex items-baseline justify-between gap-3">
                <h2 id="ledger-heading" className="text-[14px] font-semibold">
                    The ledger
                </h2>
                {state.kind === 'ready' && (
                    <a
                        href={state.ledger.contractUrl}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center gap-1 text-[12px] text-text-muted hover:text-text-primary hover:underline"
                    >
                        Contract on MonadVision
                        <ArrowUpRight size={12} aria-hidden />
                    </a>
                )}
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
                Every audit Monsmith has put on Monad mainnet, indexed by Envio from the contract&apos;s event log.
            </p>

            {state.kind === 'loading' && (
                <div className="mt-4 space-y-2" aria-busy="true" aria-label="Loading the ledger">
                    <div className="h-[68px] animate-pulse rounded-2xl bg-surface-sunken motion-reduce:animate-none" />
                    {[0, 1, 2].map((row) => (
                        <div key={row} className="h-12 animate-pulse rounded-xl bg-surface-sunken motion-reduce:animate-none" />
                    ))}
                </div>
            )}

            {state.kind === 'error' && (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface-raised px-4 py-3 text-[13px] text-text-secondary">
                    The ledger could not be read just now.
                    <button
                        type="button"
                        onClick={() => {
                            setState({ kind: 'loading' });
                            setAttempt((value) => value + 1);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-2.5 py-1 text-[12px] font-medium outline-none ring-accent-line hover:text-text-primary focus-visible:ring-2"
                    >
                        <RotateCw size={12} aria-hidden />
                        Retry
                    </button>
                </div>
            )}

            {state.kind === 'ready' && (
                <>
                    <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border-subtle bg-border-subtle sm:grid-cols-4">
                        {(
                            [
                                ['Attestations', String(state.ledger.stats.attestations)],
                                ['Sources audited', String(state.ledger.stats.sources)],
                                ['Average score', state.ledger.stats.averageScore === null ? 'n/a' : String(state.ledger.stats.averageScore)],
                                ['Critical + high found', String(state.ledger.stats.criticalFound + state.ledger.stats.highFound)],
                            ] as const
                        ).map(([label, value]) => (
                            <div key={label} className="bg-surface-raised px-4 py-3">
                                <dd className="font-mono text-[20px] font-semibold tabular-nums">{value}</dd>
                                <dt className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-text-muted">{label}</dt>
                            </div>
                        ))}
                    </dl>

                    {state.ledger.recent.length === 0 ? (
                        <p className="mt-4 text-[13px] text-text-muted">Nothing has been attested yet.</p>
                    ) : (
                        <ol className="mt-3 divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle bg-surface-raised">
                            {state.ledger.recent.map((entry) => (
                                <li key={`${entry.txHash}:${entry.sourceHash}`} className="flex items-center gap-3 px-4 py-3">
                                    <span className={`w-10 shrink-0 rounded-md border py-0.5 text-center font-mono text-[12px] font-semibold tabular-nums ${tone(entry.score)}`}>
                                        {entry.score}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-2">
                                            <span className="truncate font-mono text-[12px] text-text-primary" title={entry.sourceHash}>
                                                {entry.target.toLowerCase() === ZERO ? `source ${short(entry.sourceHash)}` : `${short(entry.target)} on chain ${entry.auditedChainId}`}
                                            </span>
                                            {entry.reattested && (
                                                <span className="shrink-0 rounded border border-border-subtle px-1 text-[10px] uppercase tracking-wide text-text-muted">re-audit</span>
                                            )}
                                        </span>
                                        <span className="block text-[11.5px] text-text-muted">
                                            {entry.critical} critical, {entry.high} high{entry.timestamp > 0 ? ` · ${ago(entry.timestamp)}` : ''}
                                        </span>
                                    </span>
                                    <a
                                        href={entry.reportURI}
                                        aria-label="Read the report"
                                        className="rounded p-1.5 text-text-muted outline-none ring-accent-line hover:text-text-primary focus-visible:ring-2"
                                    >
                                        <FileCode2 size={14} aria-hidden />
                                    </a>
                                    {entry.txHash.length > 0 && (
                                        <a
                                            href={`${state.ledger.explorer}/tx/${entry.txHash}`}
                                            target="_blank"
                                            rel="noopener"
                                            aria-label="See the transaction on MonadVision"
                                            className="rounded p-1.5 text-text-muted outline-none ring-accent-line hover:text-text-primary focus-visible:ring-2"
                                        >
                                            <ArrowUpRight size={14} aria-hidden />
                                        </a>
                                    )}
                                </li>
                            ))}
                        </ol>
                    )}
                    <p className="mt-2 text-[11.5px] text-text-muted">
                        Indexed by Envio {state.ledger.via === 'envio-hyperindex' ? 'HyperIndex' : 'HyperSync'} · also at{' '}
                        <a href="/api/attestations" className="underline">
                            /api/attestations
                        </a>
                    </p>
                </>
            )}
        </section>
    );
}
