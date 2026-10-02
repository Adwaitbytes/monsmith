'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, FileCode2, ShieldCheck, X } from 'lucide-react';

import { estimateSeconds, type AuditCandidate } from '@/lib/report/selection';
import { CONTRACTS_PER_RUN } from '@/lib/report/types';

/**
 * Choosing what the report covers.
 *
 * Running the report used to audit everything in the workspace, and in a
 * repository past the per-run cap the server chose which ten on its own. A
 * person who imported forty files to check one vault had no way to say so,
 * and waited for the other nine. This asks once, with the open file already
 * ticked, and says how long the choice will take before it starts.
 */

export interface AuditPickerProps {
    open: boolean;
    candidates: readonly AuditCandidate[];
    initial: readonly string[];
    onClose: () => void;
    onConfirm: (paths: string[]) => void;
}

const EASE = [0.16, 1, 0.3, 1] as const;

function duration(seconds: number): string {
    if (seconds < 90) return `about ${Math.max(1, Math.round(seconds / 10) * 10)} seconds`;
    return `about ${Math.round(seconds / 60)} minutes`;
}

export function AuditPicker({ open, candidates, initial, onClose, onConfirm }: AuditPickerProps) {
    const reduce = useReducedMotion();
    const titleId = useId();
    const confirmRef = useRef<HTMLButtonElement>(null);
    const [selected, setSelected] = useState<string[]>([...initial]);
    const [seenInitial, setSeenInitial] = useState(initial);

    // A new opening starts from the caller's suggestion, not the last choice.
    if (seenInitial !== initial) {
        setSeenInitial(initial);
        setSelected([...initial]);
    }

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        confirmRef.current?.focus();
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    const atCap = selected.length >= CONTRACTS_PER_RUN;
    const toggle = (path: string) =>
        setSelected((current) =>
            current.includes(path) ? current.filter((entry) => entry !== path) : current.length >= CONTRACTS_PER_RUN ? current : [...current, path],
        );
    const allPaths = candidates.map((candidate) => candidate.path);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={reduce ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18, ease: EASE }}
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) onClose();
                    }}
                >
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={titleId}
                        initial={reduce ? false : { opacity: 0, y: 12, scale: 0.985 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 12, scale: 0.985 }}
                        transition={{ duration: 0.25, ease: EASE }}
                        className="flex max-h-[min(40rem,90vh)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border-subtle bg-background shadow-2xl"
                    >
                        <header className="flex items-start gap-3 border-b border-border-subtle px-5 py-4">
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                                <ShieldCheck size={17} aria-hidden />
                            </span>
                            <div className="min-w-0 flex-1">
                                <h2 id={titleId} className="font-display text-[16px] font-semibold tracking-tight text-text-primary">
                                    Choose what to audit
                                </h2>
                                <p className="mt-0.5 text-[12.5px] text-text-secondary">
                                    {candidates.length} contracts can be audited here. Tests, interfaces and libraries are left out.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label="Close"
                                className="rounded-md p-1 text-text-muted outline-none ring-accent-line transition-colors hover:text-text-primary focus-visible:ring-2"
                            >
                                <X size={15} />
                            </button>
                        </header>

                        <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-2 text-[12px]">
                            <span className="text-text-muted">
                                {selected.length} of {Math.min(candidates.length, CONTRACTS_PER_RUN)} selected
                                {candidates.length > CONTRACTS_PER_RUN ? ` · up to ${CONTRACTS_PER_RUN} per report` : ''}
                            </span>
                            <span className="flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => setSelected(allPaths.slice(0, CONTRACTS_PER_RUN))}
                                    className="rounded font-medium text-accent outline-none ring-accent-line hover:underline focus-visible:ring-2"
                                >
                                    {candidates.length > CONTRACTS_PER_RUN ? `First ${CONTRACTS_PER_RUN}` : 'All'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSelected([])}
                                    className="rounded font-medium text-text-secondary outline-none ring-accent-line hover:text-text-primary focus-visible:ring-2"
                                >
                                    None
                                </button>
                            </span>
                        </div>

                        <ul role="listbox" aria-multiselectable="true" aria-label="Contracts" className="min-h-0 flex-1 overflow-y-auto p-2">
                            {candidates.map((candidate) => {
                                const checked = selected.includes(candidate.path);
                                const disabled = !checked && atCap;
                                return (
                                    <li key={candidate.path}>
                                        <button
                                            type="button"
                                            role="option"
                                            aria-selected={checked}
                                            disabled={disabled}
                                            onClick={() => toggle(candidate.path)}
                                            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none ring-accent-line transition-colors focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-45 ${
                                                checked ? 'bg-accent-soft' : 'hover:bg-surface-sunken'
                                            }`}
                                        >
                                            <span
                                                aria-hidden
                                                className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                                                    checked ? 'border-accent bg-accent text-white' : 'border-border-strong'
                                                }`}
                                            >
                                                {checked && <Check size={11} strokeWidth={3} />}
                                            </span>
                                            <FileCode2 size={14} aria-hidden className="shrink-0 text-text-muted" />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-[13px] font-medium text-text-primary">{candidate.name}</span>
                                                <span className="block truncate font-mono text-[11px] text-text-muted">{candidate.path}</span>
                                            </span>
                                            <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-muted">{candidate.lines} lines</span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>

                        <footer className="flex items-center justify-between gap-3 border-t border-border-subtle bg-surface-raised px-5 py-3.5">
                            <p className="text-[12px] text-text-muted">
                                {selected.length === 0 ? 'Pick at least one contract.' : `Takes ${duration(estimateSeconds(selected.length))}.`}
                            </p>
                            <button
                                ref={confirmRef}
                                type="button"
                                disabled={selected.length === 0}
                                onClick={() => onConfirm(allPaths.filter((path) => selected.includes(path)))}
                                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white outline-none ring-accent-line ring-offset-2 ring-offset-surface-raised transition-opacity hover:opacity-90 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <ShieldCheck size={14} aria-hidden />
                                Audit {selected.length} {selected.length === 1 ? 'contract' : 'contracts'}
                            </button>
                        </footer>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
