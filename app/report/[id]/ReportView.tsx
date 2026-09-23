'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, ShieldAlert } from 'lucide-react';

import type { RepoReport } from '@/lib/report/types';
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

export interface ReportViewProps {
    report: RepoReport;
    /** Preformatted on the server. See the note in the page component. */
    createdAtLabel: string;
}

function originLabel(report: RepoReport): string {
    const origin = report.origin;
    if (origin.kind === 'github') return `${origin.owner}/${origin.repo}`;
    if (origin.kind === 'address') return `${origin.address.slice(0, 10)}…${origin.address.slice(-6)}`;
    return report.contracts[0]?.name ?? 'Workspace';
}

export function ReportView({ report, createdAtLabel }: ReportViewProps) {
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
            <div className="overflow-hidden rounded-2xl border border-border-subtle">
                <div className="[&_aside]:h-auto [&_aside>div]:overflow-visible">
                    <ReportRail
                        state={{ status: 'ready', report }}
                        entitled={!report.redacted}
                        onUnlock={() => undefined}
                        unlocking={false}
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
