'use client';

import React, { useEffect, useState } from 'react';
import { Clock, ExternalLink, Loader2 } from 'lucide-react';

import type { ReportSummary } from '@/lib/report/store';

/**
 * Reports already run, so nobody pays for the same one twice.
 *
 * A full audit is minutes of compute and it was already being stored for the
 * permalink, but there was no way back to one: close the tab and the work was
 * gone unless you had copied the link first. That is the kind of gap that makes
 * people re-run rather than look, and re-running is the expensive option.
 *
 * Deliberately a list of summaries rather than a gallery of cards. This is
 * something you scan for a name and a date, and a card grid would make eight
 * reports fill a screen that a list fits forty into.
 */

export interface ReportHistoryProps {
    /** Opens a stored report, usually by navigating to its page. */
    onOpen: (reportId: string) => void;
    /** Highlights the one currently on screen. */
    activeReportId?: string | null;
}

function relative(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const minutes = Math.round((Date.now() - then) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 31) return `${days}d ago`;
    return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function gradeOf(score: number | null): { text: string; tone: string } {
    if (score === null) return { text: '--', tone: 'text-text-muted border-border-subtle' };
    if (score >= 90) return { text: 'A', tone: 'text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/10' };
    if (score >= 75) return { text: 'B', tone: 'text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/10' };
    if (score >= 60) return { text: 'C', tone: 'text-amber-700 dark:text-amber-300 border-amber-500/30 bg-amber-500/10' };
    if (score >= 40) return { text: 'D', tone: 'text-orange-700 dark:text-orange-300 border-orange-500/30 bg-orange-500/10' };
    return { text: 'F', tone: 'text-red-700 dark:text-red-300 border-red-500/30 bg-red-500/10' };
}

export function ReportHistory({ onOpen, activeReportId }: ReportHistoryProps) {
    const [reports, setReports] = useState<ReportSummary[] | null>(null);

    useEffect(() => {
        let live = true;
        void (async () => {
            try {
                const response = await fetch('/api/reports');
                const data = (await response.json()) as { reports?: ReportSummary[] };
                if (live) setReports(data.reports ?? []);
            } catch {
                // An unreachable history reads as an empty one. The studio does
                // not depend on it and must not show an error for it.
                if (live) setReports([]);
            }
        })();
        return () => {
            live = false;
        };
    }, []);

    return (
        <section className="border-t border-border-subtle">
            <div className="flex items-center gap-2 px-3 py-2.5">
                <Clock size={12} className="text-text-muted" />
                <h3 className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    Past reports
                </h3>
                {reports !== null && reports.length > 0 && (
                    <span className="text-[10.5px] tabular-nums text-text-muted">{reports.length}</span>
                )}
            </div>

            {reports === null && (
                <p className="flex items-center gap-1.5 px-3 pb-3 text-[11.5px] text-text-muted">
                    <Loader2 size={11} className="animate-spin motion-reduce:animate-none" />
                    Loading
                </p>
            )}

            {reports !== null && reports.length === 0 && (
                <p className="px-3 pb-3 text-[11.5px] leading-relaxed text-text-muted">
                    Reports you run are kept here, so you can come back to one without measuring it
                    again.
                </p>
            )}

            <div className="max-h-56 overflow-y-auto pb-1">
                {reports?.map((entry) => {
                    const grade = gradeOf(entry.healthScore);
                    const active = entry.reportId === activeReportId;
                    return (
                        <button
                            key={entry.reportId}
                            onClick={() => onOpen(entry.reportId)}
                            className={`group flex w-full items-center gap-2 px-3 py-1.5 text-left outline-none transition-colors ${
                                active ? 'bg-accent-soft' : 'hover:bg-border-subtle/50'
                            }`}
                        >
                            <span
                                className={`grid h-5 w-5 shrink-0 place-items-center rounded border text-[10px] font-bold ${grade.tone}`}
                            >
                                {grade.text}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[12px] text-text-primary">
                                    {entry.subject}
                                </span>
                                <span className="block text-[10.5px] text-text-muted">
                                    {entry.contracts === 1 ? '1 contract' : `${entry.contracts} contracts`}
                                    {' · '}
                                    {relative(entry.createdAt)}
                                </span>
                            </span>
                            <ExternalLink
                                size={11}
                                className="shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100"
                            />
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
