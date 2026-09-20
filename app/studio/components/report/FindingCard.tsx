'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Check, ChevronRight, Copy, Lock, Wand2 } from 'lucide-react';

import type { Finding, Severity } from '@/lib/report/types';

/**
 * One finding, in both halves of the product.
 *
 * The locked state is the load-bearing decision in this file. The obvious way to
 * build a paywall is to render the real text and blur it, which for this
 * audience is not a paywall at all, and the honest version is better business
 * anyway: the severity chip and the title stay completely readable, and the body
 * becomes plain redaction bars. A reader can count the critical findings, see
 * what they are called, and decide whether the detail is worth paying for. What
 * they can never see is invented filler, because the redacted payload carries no
 * body text for us to fake and we would not print it if it did.
 *
 * Unlocked, the card reads in the order a developer works: what it is, where it
 * is, why it matters, the offending source, the repair. The file and line are
 * copyable because the next thing anyone does with them is paste them somewhere
 * else, and the patch button appears only when a patch genuinely exists rather
 * than sitting disabled as a permanent advertisement.
 */

export interface SeverityStyle {
    label: string;
    /** Bordered chip, matching the treatment the older panels already use. */
    chip: string;
    /** Solid left rail, so severity is legible before any text is read. */
    rail: string;
}

export const SEVERITY_STYLES: Readonly<Record<Severity, SeverityStyle>> = {
    critical: {
        label: 'Critical',
        chip: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
        rail: 'bg-red-500',
    },
    high: {
        label: 'High',
        chip: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
        rail: 'bg-orange-500',
    },
    medium: {
        label: 'Medium',
        chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
        rail: 'bg-amber-500',
    },
    low: {
        label: 'Low',
        chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
        rail: 'bg-emerald-500',
    },
    info: {
        label: 'Info',
        chip: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30',
        rail: 'bg-slate-400',
    },
};

const SOURCE_LABELS: Readonly<Record<Finding['source'], string>> = {
    security: 'Security scan',
    parallel: 'Parallel analysis',
    gas: 'Gas profile',
    chainfit: 'Chain fit',
    ai: 'AI review',
};

/** `contracts/Vault.sol:214`, or just the path, or nothing at all. */
function locationOf(finding: Finding): string | null {
    if (typeof finding.file !== 'string' || finding.file.length === 0) return null;
    return typeof finding.line === 'number' && Number.isFinite(finding.line)
        ? `${finding.file}:${finding.line}`
        : finding.file;
}

function CopyableLocation({ location }: { location: string }) {
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!copied) return;
        const timer = window.setTimeout(() => setCopied(false), 1600);
        return () => window.clearTimeout(timer);
    }, [copied]);

    const copy = useCallback(() => {
        const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
        // Insecure origins and locked-down browsers have no clipboard at all, so
        // the text stays selectable and the button simply does nothing visible.
        if (clipboard === undefined) return;
        clipboard.writeText(location).then(
            () => setCopied(true),
            () => setCopied(false),
        );
    }, [location]);

    return (
        <button
            type="button"
            onClick={copy}
            aria-label={copied ? `Copied ${location}` : `Copy ${location}`}
            className="group/copy inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-text-muted transition-colors duration-150 hover:bg-surface-sunken hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface-raised motion-reduce:transition-none"
        >
            <span className="truncate">{location}</span>
            {copied ? (
                <Check className="h-3 w-3 shrink-0 text-emerald-500" strokeWidth={2} aria-hidden="true" />
            ) : (
                <Copy
                    className="h-3 w-3 shrink-0 opacity-0 transition-opacity duration-150 group-hover/copy:opacity-100 group-focus-visible/copy:opacity-100 motion-reduce:transition-none"
                    strokeWidth={1.75}
                    aria-hidden="true"
                />
            )}
        </button>
    );
}

/**
 * The redacted body.
 *
 * Bars rather than blurred text, at irregular widths so it reads as withheld
 * prose instead of a loading skeleton that will never resolve.
 */
function RedactedBody({ onReveal }: { onReveal?: () => void }) {
    return (
        <div className="space-y-3">
            <div className="space-y-1.5" aria-hidden="true">
                {['100%', '92%', '64%'].map((width) => (
                    <span key={width} style={{ width }} className="block h-2 rounded-full bg-border-strong/70" />
                ))}
            </div>

            <div className="rounded-lg border border-dashed border-border-subtle bg-surface-sunken p-3">
                <div className="space-y-1.5" aria-hidden="true">
                    {['74%', '88%', '46%'].map((width) => (
                        <span key={width} style={{ width }} className="block h-2 rounded-full bg-border-strong/50" />
                    ))}
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <Lock className="h-3 w-3 shrink-0 text-text-muted" strokeWidth={1.75} aria-hidden="true" />
                <span className="text-[11.5px] text-text-muted">
                    What it is, where it is and how to fix it are in the full report.
                </span>
                {onReveal !== undefined && (
                    <button
                        type="button"
                        onClick={onReveal}
                        className="rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-accent underline-offset-2 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface-raised motion-reduce:transition-none"
                    >
                        Unlock
                    </button>
                )}
            </div>
        </div>
    );
}

function UnlockedBody({
    finding,
    onApplyPatch,
}: {
    finding: Finding;
    onApplyPatch?: (finding: Finding) => void;
}) {
    const hasPatch = typeof finding.patch === 'string' && finding.patch.length > 0;

    return (
        <div className="space-y-3">
            {finding.description !== undefined && finding.description.length > 0 && (
                <p className="text-[12.5px] leading-relaxed text-text-secondary">{finding.description}</p>
            )}

            {finding.evidence !== undefined && finding.evidence.length > 0 && (
                <pre className="overflow-x-auto rounded-lg border border-border-subtle bg-surface-sunken p-3 font-mono text-[11.5px] leading-relaxed text-text-primary">
                    <code>{finding.evidence}</code>
                </pre>
            )}

            {finding.fix !== undefined && finding.fix.length > 0 && (
                <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2.5">
                    <h5 className="text-[10.5px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                        The fix
                    </h5>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">{finding.fix}</p>
                </div>
            )}

            {hasPatch && onApplyPatch !== undefined && (
                <button
                    type="button"
                    onClick={() => onApplyPatch(finding)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white shadow-[var(--shadow-panel)] transition-opacity duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised motion-reduce:transition-none"
                >
                    <Wand2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                    Apply fix
                </button>
            )}

            {finding.description === undefined && finding.evidence === undefined && finding.fix === undefined && (
                <p className="text-[12px] leading-relaxed text-text-muted">
                    This finding carries no further detail than its title.
                </p>
            )}
        </div>
    );
}

export interface FindingCardProps {
    finding: Finding;
    /** True when the paid half of this finding was withheld by the server. */
    locked: boolean;
    /** Offered inside the locked body, so the pitch sits where the gap is. */
    onReveal?: () => void;
    onApplyPatch?: (finding: Finding) => void;
}

export function FindingCard({ finding, locked, onReveal, onApplyPatch }: FindingCardProps) {
    const style = SEVERITY_STYLES[finding.severity] ?? SEVERITY_STYLES.info;
    const location = locationOf(finding);
    const bodyId = useId();

    // The worst findings open on arrival. Anything milder starts collapsed so a
    // long list stays scannable, which is the whole reason the rail is one
    // document rather than six panels.
    const [open, setOpen] = useState(finding.severity === 'critical' || finding.severity === 'high');

    return (
        <article className="group relative overflow-hidden rounded-xl border border-border-subtle bg-surface-raised transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-border-strong motion-reduce:transition-none">
            <span className={`absolute inset-y-0 left-0 w-0.5 ${style.rail}`} aria-hidden="true" />

            <h4>
                <button
                    type="button"
                    onClick={() => setOpen((value) => !value)}
                    aria-expanded={open}
                    aria-controls={bodyId}
                    className="flex w-full items-start gap-2.5 px-3.5 py-3 pl-4 text-left transition-colors duration-150 hover:bg-surface-sunken/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent motion-reduce:transition-none"
                >
                    <ChevronRight
                        className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
                        strokeWidth={2}
                        aria-hidden="true"
                    />

                    <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none ${style.chip}`}>
                                {style.label}
                            </span>
                            {locked && (
                                <Lock className="h-3 w-3 text-text-muted" strokeWidth={1.75} aria-label="Locked" />
                            )}
                        </span>
                        <span className="mt-1.5 block text-[13px] font-medium leading-snug text-text-primary">
                            {finding.title}
                        </span>
                    </span>
                </button>
            </h4>

            <div id={bodyId} hidden={!open} className="space-y-3 px-4 pb-3.5 pl-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {location !== null && <CopyableLocation location={location} />}
                    <span className="text-[10.5px] uppercase tracking-wider text-text-muted">
                        {SOURCE_LABELS[finding.source] ?? finding.source}
                    </span>
                </div>

                {locked ? (
                    <RedactedBody onReveal={onReveal} />
                ) : (
                    <UnlockedBody finding={finding} onApplyPatch={onApplyPatch} />
                )}
            </div>
        </article>
    );
}

export default FindingCard;
