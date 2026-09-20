'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Loader2, Rocket, ShieldCheck } from 'lucide-react';

import { MonsmithMark } from '../../landing/MonsmithMark';
import { modifierLabel } from '../commands';

/**
 * The studio's top bar, at four controls.
 *
 * It carried seventeen. Three action buttons, a language toggle, a network
 * pill, a theme button, a terminal button, and six unlabelled 32px icons for
 * six side panels, two of which used the same icon as each other and so could
 * not be told apart at all. The feedback was that the product looked like it
 * did too much to understand, and that was a fair reading of this bar.
 *
 * What is left is the smallest set that answers the only two questions someone
 * has on arrival: where am I, and what do I do next.
 *
 *   identity   the mark and the file being worked on
 *   palette    one hint that everything else is a keystroke away
 *   action     exactly one primary button, labelled by what comes next
 *   account    the settings that were masquerading as actions
 *
 * Compile is gone as a button because compiling is not a goal anyone has. The
 * report compiles on its own, and the button that remains says the thing the
 * person actually wants: deploy it, or audit it. Everything removed lives in
 * the command palette or the account menu, so nothing was taken away from the
 * product, only from the bar.
 */

export type PrimaryAction = 'report' | 'deploy';

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
            <div className="flex shrink-0 items-center gap-2">
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
