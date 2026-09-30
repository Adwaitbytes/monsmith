'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';

import { useReportUnlock } from '@/lib/billing/useReportUnlock';
import type { RepoReport } from '@/lib/report/types';
import { visitorId } from '@/lib/visitor';
import { ReportRail } from '../../studio/components/report/ReportRail';

/**
 * A report read on its own, rather than beside an editor.
 *
 * The rail does the rendering. Reimplementing it here to suit a wider column
 * would mean two places where a finding is laid out and two places to keep in
 * step, and the one that got less attention would be the one people share.
 * What changes is the frame around it: a stated subject, when it was run, and a
 * way into the studio for a reader who decides they want to fix something.
 *
 * The column is held narrow on purpose. This is a document, and a document set
 * to the full width of a monitor is one nobody finishes.
 */

/** Where Dodo's checkout sent the customer back, read from the URL on the server. */
export interface CheckoutReturn {
    /** Absent when the checkout was cancelled rather than paid. */
    paymentId: string | null;
}

export interface ReportViewProps {
    report: RepoReport;
    checkout?: CheckoutReturn | null;
    /** Preformatted on the server. See the note in the page component. */
    createdAtLabel: string;
}

function originLabel(report: RepoReport): string {
    const origin = report.origin;
    if (origin.kind === 'github') return `${origin.owner}/${origin.repo}`;
    if (origin.kind === 'address') return `${origin.address.slice(0, 10)}…${origin.address.slice(-6)}`;
    return report.contracts[0]?.name ?? 'Workspace';
}

type Return =
    | { kind: 'none' }
    | { kind: 'confirming' }
    | { kind: 'unlocked' }
    | { kind: 'cancelled' }
    | { kind: 'failed'; message: string };

const CONFIRM_ATTEMPTS = 15;
const CONFIRM_INTERVAL_MS = 2000;

/**
 * Finishes a card payment when Dodo sends the customer back here.
 *
 * The webhook usually unlocks the report before the redirect lands, but not
 * always, and a customer who has just paid should never be shown a lock. So the
 * page asks the server to confirm the payment itself, and waits while the bank
 * is still deciding, rather than trusting either path alone.
 */
function initialReturn(checkout: CheckoutReturn | null): Return {
    if (checkout === null) return { kind: 'none' };
    if (checkout.paymentId === null) return { kind: 'cancelled' };
    return { kind: 'confirming' };
}

function useCheckoutReturn(
    reportId: string,
    checkout: CheckoutReturn | null,
    onUnlocked: (report: RepoReport) => void,
): [Return, () => void] {
    const [status, setStatus] = useState<Return>(() => initialReturn(checkout));
    const paymentId = checkout?.paymentId ?? null;
    const returned = checkout !== null;

    useEffect(() => {
        if (!returned) return;
        // The query has done its job; a refresh or a shared link should not
        // replay it.
        window.history.replaceState(null, '', window.location.pathname);
        if (paymentId === null) return;

        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const attempt = async (left: number) => {
            try {
                const response = await fetch(`/api/report/${reportId}/checkout/confirm`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-visitor-id': visitorId() },
                    body: JSON.stringify({ paymentId }),
                });
                const data = (await response.json()) as { report?: RepoReport; pending?: boolean; error?: string };
                if (stopped) return;
                if (response.ok && data.report !== undefined) {
                    onUnlocked(data.report);
                    setStatus({ kind: 'unlocked' });
                    return;
                }
                if (response.status === 202 && left > 0) {
                    timer = setTimeout(() => void attempt(left - 1), CONFIRM_INTERVAL_MS);
                    return;
                }
                setStatus({
                    kind: 'failed',
                    message:
                        response.status === 202
                            ? 'Your bank is still confirming the payment. The report unlocks by itself once it clears, so check back in a few minutes.'
                            : (data.error ?? 'The payment could not be confirmed.'),
                });
            } catch {
                if (!stopped) setStatus({ kind: 'failed', message: 'Could not confirm the payment. Refresh to try again.' });
            }
        };
        void attempt(CONFIRM_ATTEMPTS);

        return () => {
            stopped = true;
            if (timer !== undefined) clearTimeout(timer);
        };
    }, [reportId, returned, paymentId, onUnlocked]);

    return [status, () => setStatus({ kind: 'none' })];
}

function ReturnBanner({ status, onDismiss }: { status: Return; onDismiss: () => void }) {
    if (status.kind === 'none') return null;

    const tone =
        status.kind === 'unlocked'
            ? 'border-emerald-500/30 bg-emerald-500/[0.08]'
            : status.kind === 'failed'
              ? 'border-red-500/30 bg-red-500/[0.08]'
              : 'border-border-subtle bg-surface-sunken';

    return (
        <div role="status" aria-live="polite" className={`mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 ${tone}`}>
            {status.kind === 'confirming' && (
                <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-text-muted motion-reduce:animate-none" />
            )}
            {status.kind === 'unlocked' && (
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            )}
            {(status.kind === 'failed' || status.kind === 'cancelled') && (
                <AlertTriangle
                    size={16}
                    className={`mt-0.5 shrink-0 ${status.kind === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-text-muted'}`}
                />
            )}
            <p className="flex-1 text-[13px] leading-relaxed text-text-primary">
                {status.kind === 'confirming' && 'Confirming your payment. This takes a few seconds.'}
                {status.kind === 'unlocked' && 'Payment received. The full report is unlocked below, and a receipt is on its way to your email.'}
                {status.kind === 'cancelled' && 'Checkout was cancelled, and nothing was charged.'}
                {status.kind === 'failed' && status.message}
            </p>
            {status.kind !== 'confirming' && (
                <button
                    type="button"
                    onClick={onDismiss}
                    className="rounded text-[12px] text-text-muted outline-none ring-accent-line transition-colors hover:text-text-primary focus-visible:ring-2"
                >
                    Dismiss
                </button>
            )}
        </div>
    );
}

export function ReportView({ report: initial, createdAtLabel, checkout = null }: ReportViewProps) {
    // Held in state so an unlock, by payment or by signing in, opens the
    // report in place instead of sending the reader through a reload.
    const [report, setReport] = useState(initial);
    const [returned, dismissReturn] = useCheckoutReturn(initial.reportId, checkout, setReport);
    const unlock = useReportUnlock({ report, onReplace: setReport });

    const subject = originLabel(report);
    const contracts = report.contracts.length;

    return (
        <main className="mx-auto max-w-3xl px-6 py-12">
            <header className="mb-8">
                {/*
                  A way back, because a report is usually not where someone
                  meant to end up permanently. Pointing at the studio rather
                  than at browser history: a report reached from a shared link
                  has no history to go back to, and a dead back button is worse
                  than none.
                */}
                <Link
                    href="/studio"
                    className="group mb-6 inline-flex items-center gap-1.5 text-[12.5px] text-text-muted outline-none ring-accent-line transition-colors hover:text-text-secondary focus-visible:ring-2"
                >
                    <ArrowLeft
                        size={13}
                        className="transition-transform group-hover:-translate-x-0.5 motion-reduce:transition-none"
                    />
                    Back to the studio
                </Link>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-muted">
                    Contract audit
                </p>
                <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                    {subject}
                </h1>
                <p className="mt-2 text-[13.5px] text-text-secondary">
                    {contracts === 1 ? '1 contract' : `${contracts} contracts`} audited
                    {createdAtLabel !== '' ? ` on ${createdAtLabel}` : ''}.
                </p>
            </header>

            {/*
              The rail assumes a fixed-height parent it can scroll inside. On a
              page the document should scroll instead, so it is given a height
              that grows with the content rather than one that traps it.
            */}
            <ReturnBanner status={returned} onDismiss={dismissReturn} />

            <div className="overflow-hidden rounded-2xl border border-border-subtle">
                <div className="[&_aside]:h-auto [&_aside>div]:overflow-visible">
                    <ReportRail
                        state={{ status: 'ready', report }}
                        entitled={!report.redacted}
                        onUnlock={unlock.unlock}
                        offer={unlock.offer}
                        unlocking={unlock.busy || returned.kind === 'confirming'}
                        unlockError={unlock.error}
                    />
                </div>
            </div>

            <section className="mt-10 rounded-2xl border border-border-subtle bg-surface-sunken p-6">
                <div className="flex items-start gap-3">
                    <ShieldAlert size={18} className="mt-0.5 shrink-0 text-text-muted" />
                    <div>
                        <h2 className="font-display text-[15px] font-semibold">
                            An audit is not a guarantee
                        </h2>
                        <p className="mt-1.5 text-[13px] leading-relaxed text-text-secondary">
                            This report is produced by static analysis, a local EVM run and a
                            language model working to a threat model. It finds real problems and it
                            misses things. Treat it as a first pass that tells you where to look,
                            not as a substitute for review before real money is at stake.
                        </p>
                    </div>
                </div>

                <Link
                    href="/studio"
                    className="group mt-5 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                >
                    Audit your own contract
                    <ArrowRight
                        size={14}
                        className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                    />
                </Link>
            </section>
        </main>
    );
}
