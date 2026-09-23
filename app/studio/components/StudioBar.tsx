'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Loader2, Rocket, ShieldCheck } from 'lucide-react';

import { MonsmithMark } from '../../landing/MonsmithMark';
import { modifierLabel } from '../commands';

/**
 * The studio's top bar.
 *
 * It carried seventeen controls, nine of them unlabelled 32px icons, two of
 * which shared a glyph and so could not be told apart at all. That was the
 * complaint, and it was a fair one.
 *
 * The first fix read it as "too many buttons" and deleted capability, compile
 * and deploy included. That was wrong, and VS Code is the proof: it carries far
 * more than this and reads as calm, because every control is labelled, visually
 * distinct, and lives in a predictable lane. The problem was never the count.
 * It was nine things that looked identical competing in one row.
 *
 * So the bar carries what a contract IDE is actually for:
 *
 *   identity   the mark and the file being worked on
 *   palette    the long tail, one keystroke away
 *   actions    compile and deploy, labelled, distinct, disabled with a reason
 *   primary    the one thing to do next, emphasised over the rest
 *   account    settings, which are state rather than actions
 *
 * Everything else moved to a lane of its own: tools to the activity bar on the
 * left, ambient state to the status bar along the bottom.
 */

export type PrimaryAction = 'report' | 'deploy';

export interface BarAction {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    busy?: boolean;
    /** Disabled with the reason on hover, rather than failing after the click. */
    blockedReason?: string;
}

export interface StudioBarProps {
    /** Path of the open file, or the repository when one was imported. */
    title: string;
    /** Shown under the title when the workspace came from somewhere nameable. */
    subtitle?: string;
    primary: PrimaryAction;
    busy: boolean;
    /** Disables the primary action and explains why on hover. */
    primaryBlockedReason?: string;
    onPrimary: () => void;
    onOpenPalette: () => void;
    account: React.ReactNode;
    /**
     * The everyday actions, beside the primary one.
     *
     * Cutting these was an over-correction. Compile and deploy are the two
     * things a contract IDE exists to do, and the original complaint was about
     * nine unlabelled icons that looked alike, not about having actions at all.
     * Labelled, distinct and few is the shape that was actually being asked for.
     */
    actions?: readonly BarAction[];
}

const PRIMARY_COPY: Record<PrimaryAction, { label: string; busy: string; icon: typeof Rocket }> = {
    // "Run the full report" rather than "Audit" because the report is the
    // artifact, and naming the artifact is what makes the click predictable.
    report: { label: 'Run the full report', busy: 'Measuring', icon: ShieldCheck },
    deploy: { label: 'Deploy', busy: 'Deploying', icon: Rocket },
};

export function StudioBar({
    title,
    subtitle,
    primary,
    busy,
    primaryBlockedReason,
    onPrimary,
    onOpenPalette,
    account,
    actions = [],
}: StudioBarProps) {
    const copy = PRIMARY_COPY[primary];
    const Icon = copy.icon;
    const blocked = primaryBlockedReason !== undefined;

    return (
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border-subtle bg-surface-raised px-4">
            {/* Identity and place */}
            <div className="flex min-w-0 items-center gap-2.5">
                <Link
                    href="/"
                    aria-label="Monsmith home"
                    className="shrink-0 rounded-md outline-none ring-accent-line transition-transform focus-visible:ring-2 hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100"
                >
                    <MonsmithMark size={22} />
                </Link>
                <span aria-hidden className="h-4 w-px shrink-0 bg-border-strong" />
                <div className="min-w-0 leading-tight">
                    <p className="truncate text-[13px] font-medium text-text-primary">{title}</p>
                    {subtitle !== undefined && (
                        <p className="truncate font-mono text-[10.5px] text-text-muted">{subtitle}</p>
                    )}
                </div>
            </div>

            {/* The one hint that the rest of the product exists */}
            <button
                onClick={onOpenPalette}
                className="group hidden min-w-[260px] items-center gap-2 rounded-lg border border-border-subtle bg-surface-sunken px-3 py-1.5 text-[12.5px] text-text-muted outline-none ring-accent-line transition-colors hover:border-border-strong hover:text-text-secondary focus-visible:ring-2 md:flex"
            >
                <span className="flex-1 text-left">Search commands, files and actions</span>
                <kbd className="rounded border border-border-subtle bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                    {modifierLabel()}K
                </kbd>
            </button>

            {/* One action, and the settings that were pretending to be actions */}
            <div className="flex shrink-0 items-center gap-1.5">
                {actions.map((action) => {
                    const blocked = action.blockedReason !== undefined;
                    return (
                        <button
                            key={action.label}
                            onClick={action.onClick}
                            disabled={blocked || action.busy === true}
                            title={action.blockedReason}
                            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] font-medium outline-none ring-accent-line transition-colors focus-visible:ring-2 ${
                                blocked || action.busy === true
                                    ? 'cursor-not-allowed border-border-subtle text-text-muted'
                                    : 'border-border-subtle text-text-secondary hover:border-border-strong hover:text-text-primary'
                            }`}
                        >
                            {action.busy === true ? (
                                <Loader2
                                    size={14}
                                    className="animate-spin motion-reduce:animate-none"
                                />
                            ) : (
                                action.icon
                            )}
                            {action.label}
                        </button>
                    );
                })}

                <motion.button
                    onClick={onPrimary}
                    disabled={busy || blocked}
                    title={primaryBlockedReason}
                    whileTap={blocked || busy ? undefined : { scale: 0.98 }}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 text-[12.5px] font-semibold outline-none ring-accent-line transition-opacity focus-visible:ring-2 ${
                        busy || blocked
                            ? 'cursor-not-allowed bg-surface-overlay text-text-muted'
                            : 'bg-accent text-white hover:opacity-90'
                    }`}
                >
                    {busy ? (
                        <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
                    ) : (
                        <Icon size={14} />
                    )}
                    {busy ? copy.busy : copy.label}
                </motion.button>

                {account}
            </div>
        </header>
    );
}
