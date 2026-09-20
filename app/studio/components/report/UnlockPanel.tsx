'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, Check, Loader2, Lock } from 'lucide-react';

import type { LockedSummary } from '@/lib/report/redact';
import type { RepoReport } from '@/lib/report/types';

/**
 * The close of the report, and the only place money is mentioned.
 *
 * Every sentence in here is assembled from `summary`, which the server derived
 * from the real report. That constraint is the point. A panel that says "unlock
 * the full analysis" is indistinguishable from every growth-hack interstitial a
 * developer has learned to scroll past, whereas "seven more findings,
 * per-function gas for four contracts and the chain-by-chain comparison" is a
 * claim that can be checked against the counts already visible above it. If the
 * report withheld nothing, this panel says so and offers nothing to buy.
 *
 * Settlement in MON over one signature is stated plainly rather than tucked into
 * fine print, because for this audience that is the interesting part: no card,
 * no account, no redirect. The visual weight is deliberately no greater than a
 * section of the report, since it is one.
 */

/** "a", "a and b", "a, b and c". Plain prose, not a bullet list in disguise. */
function joinPhrases(items: readonly string[]): string {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function plural(count: number, singular: string): string {
    return count === 1 ? singular : `${singular}s`;
}

/**
 * What unlocking adds, in the reader's words.
 *
 * Each clause is gated on the summary reporting that the thing exists, so the
 * promise shrinks honestly on a report that has less in it.
 */
function buildPromise(summary: LockedSummary): string[] {
    const items: string[] = [];

    if (summary.lockedFindings > 0) {
        items.push(`${summary.lockedFindings} more ${plural(summary.lockedFindings, 'finding')} in full`);
    }
    if (summary.contractsMeasured > 0) {
        items.push(
            `per-function gas for ${summary.contractsMeasured} ${plural(summary.contractsMeasured, 'contract')}`,
        );
    }
    if (summary.hasChainFit) {
        items.push('the chain-by-chain cost comparison');
    }
    if (summary.hasPatches) {
        items.push('applicable patches for the mechanical fixes');
    }

    return items;
}

type PanelState = 'first-report-free' | 'locked' | 'unlocking' | 'error';

function stateOf(report: RepoReport, unlocking: boolean, error: string | null | undefined): PanelState {
    if (!report.redacted) return 'first-report-free';
    if (unlocking) return 'unlocking';
    if (typeof error === 'string' && error.length > 0) return 'error';
    return 'locked';
}

function Shell({ children }: { children: ReactNode }) {
    return (
        <section
            aria-labelledby="report-unlock-heading"
            className="overflow-hidden rounded-xl border border-border-subtle bg-surface-raised shadow-[var(--shadow-panel)]"
        >
            {children}
        </section>
    );
}

export interface UnlockPanelProps {
    report: RepoReport;
    summary: LockedSummary;
    onUnlock: () => void;
    unlocking: boolean;
    error?: string | null;
}

export function UnlockPanel({ report, summary, onUnlock, unlocking, error }: UnlockPanelProps) {
    const state = stateOf(report, unlocking, error);

    if (state === 'first-report-free') {
        return (
            <Shell>
                <div className="flex items-start gap-3 px-4 py-4">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
                        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" strokeWidth={2.25} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                        <h3 id="report-unlock-heading" className="text-[13px] font-semibold text-text-primary">
                            This report is yours in full
                        </h3>
                        <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-secondary">
                            Your first report is free and nothing in it is held back. Later reports unlock for a small
                            payment in MON on Monad, which takes one signature and no account.
                        </p>
                    </div>
                </div>
            </Shell>
        );
    }

    const promise = buildPromise(summary);

    // A report with nothing withheld must not be sold. This happens for real:
    // a clean contract can produce fewer findings than the free allowance.
    if (promise.length === 0) {
        return (
            <Shell>
                <div className="px-4 py-4">
                    <h3 id="report-unlock-heading" className="text-[13px] font-semibold text-text-primary">
                        Nothing is held back here
                    </h3>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-secondary">
                        This report produced less than the free allowance covers, so you are already looking at all of
                        it. There is nothing to unlock.
                    </p>
                </div>
            </Shell>
        );
    }

    return (
        <Shell>
            <div className="px-4 py-4">
                <div className="flex items-center gap-2">
                    <Lock className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.75} aria-hidden="true" />
                    <h3 id="report-unlock-heading" className="text-[13px] font-semibold text-text-primary">
                        Unlock the full report
                    </h3>
                </div>

                <p className="mt-2 text-[12.5px] leading-relaxed text-text-secondary">
                    Unlocking adds {joinPhrases(promise)}. The severities and counts above are already the real ones.
                </p>

                <p className="mt-2.5 text-[11.5px] leading-relaxed text-text-muted">
                    Payment settles in MON on Monad. One signature in your wallet, no account and no card.
                </p>

                {state === 'error' && (
                    <div
                        role="alert"
                        className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/[0.08] px-3 py-2"
                    >
                        <AlertTriangle
                            className="mt-px h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400"
                            strokeWidth={1.75}
                            aria-hidden="true"
                        />
                        <p className="text-[12px] leading-relaxed text-text-secondary">{error}</p>
                    </div>
                )}

                <div className="mt-3.5 flex items-center gap-3">
                    <button
                        type="button"
                        onClick={onUnlock}
                        disabled={state === 'unlocking'}
                        className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-white shadow-[var(--shadow-panel)] transition-opacity duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised disabled:cursor-not-allowed disabled:opacity-70 motion-reduce:transition-none"
                    >
                        {state === 'unlocking' && (
                            <Loader2
                                className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                                strokeWidth={2}
                                aria-hidden="true"
                            />
                        )}
                        {state === 'unlocking' ? 'Waiting for your signature' : 'Unlock with MON'}
                    </button>

                    {state === 'unlocking' && (
                        <p aria-live="polite" className="text-[11.5px] leading-relaxed text-text-muted">
                            Approve the request in your wallet to finish.
                        </p>
                    )}
                </div>
            </div>
        </Shell>
    );
}

export default UnlockPanel;
