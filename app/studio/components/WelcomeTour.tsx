'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { FileCode, Gauge, Github, Rocket, ShieldCheck, X } from 'lucide-react';

/**
 * The first thirty seconds.
 *
 * The feedback that started this work was that a new visitor could not tell
 * what the product did. Cutting the toolbar fixed the noise, but silence is not
 * the same as an explanation: someone who has never seen a contract audit still
 * needs to be told what the thing in front of them is for.
 *
 * This is a card, not a coach-mark tour pinned to elements. Pinned tours break
 * whenever the layout changes, they trap people who just want to start, and
 * they teach the position of buttons rather than what the product does. Four
 * cards that explain the job, with a skip in reach at every step, respect
 * someone who already knows what they came for.
 *
 * It shows once. The dismissal is remembered per browser, and every step is
 * reachable afterwards from the command palette, because a tour someone can
 * never see again is a tour that has to be perfect the first time.
 */

const SEEN_KEY = 'monsmith.tour.seen';

interface Step {
    icon: React.ReactNode;
    title: string;
    body: string;
    /** Shown as the visual, so a step is never a wall of text. */
    visual: React.ReactNode;
}

function Chip({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'bad' | 'good' }) {
    const tones = {
        neutral: 'border-border-subtle text-text-muted',
        bad: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
        good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    } as const;
    return (
        <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${tones[tone]}`}>
            {children}
        </span>
    );
}

const STEPS: readonly Step[] = [
    {
        icon: <ShieldCheck size={18} />,
        title: 'This audits smart contracts',
        body: 'Point it at Solidity and it tells you what is wrong with it, what it costs to run, and how it behaves on Monad. One pass, one report.',
        visual: (
            <div className="flex items-center gap-2">
                <span className="font-display text-3xl font-semibold text-text-primary">68</span>
                <div className="flex flex-col gap-1">
                    <Chip tone="bad">2 high</Chip>
                    <Chip>4 medium</Chip>
                </div>
            </div>
        ),
    },
    {
        icon: <Github size={18} />,
        title: 'Bring in your code',
        body: 'Paste a GitHub repository, a deployed contract address, or Solidity straight from your clipboard. Public repositories need no account.',
        visual: (
            <div className="w-full rounded-lg border border-border-subtle bg-surface-sunken px-3 py-2 font-mono text-[11.5px] text-text-secondary">
                github.com/your/repo
            </div>
        ),
    },
    {
        icon: <Gauge size={18} />,
        title: 'Read one report, not six panels',
        body: 'Security findings, gas per function, how well it parallelises on Monad, and what it would cost on other chains. All in the panel on the right, filling in as each measurement lands.',
        visual: (
            <div className="flex flex-wrap gap-1.5">
                <Chip>Security</Chip>
                <Chip>Parallel</Chip>
                <Chip>Gas</Chip>
                <Chip>Chain fit</Chip>
            </div>
        ),
    },
    {
        icon: <Rocket size={18} />,
        title: 'Then ship it',
        body: 'Deploy to Monad from the button in the top bar. Everything else lives in the command palette, so the screen stays out of your way.',
        visual: (
            <div className="flex items-center gap-2">
                <kbd className="rounded border border-border-subtle bg-surface-sunken px-2 py-1 font-mono text-[11px] text-text-secondary">
                    ⌘K
                </kbd>
                <span className="text-[12px] text-text-muted">for everything else</span>
            </div>
        ),
    },
];

export interface WelcomeTourProps {
    /** Rendered only when the host decides this is a first visit. */
    open: boolean;
    onClose: () => void;
    /** Runs when someone finishes rather than skipping, so the host can act. */
    onFinish?: () => void;
}

/** Whether this browser has been shown the tour. Safe when storage is blocked. */
export function tourSeen(): boolean {
    try {
        return window.localStorage.getItem(SEEN_KEY) === '1';
    } catch {
        // A private window that refuses storage should still not be nagged on
        // every render, so an unreadable store counts as seen.
        return true;
    }
}

export function markTourSeen(): void {
    try {
        window.localStorage.setItem(SEEN_KEY, '1');
    } catch {
        // Nothing to do. The tour reappears next visit, which is a small cost.
    }
}

export function WelcomeTour({ open, onClose, onFinish }: WelcomeTourProps) {
    const [index, setIndex] = useState(0);
    const reduce = useReducedMotion();
    const step = STEPS[index];
    const last = index === STEPS.length - 1;

    const dismiss = useCallback(
        (finished: boolean) => {
            markTourSeen();
            if (finished) onFinish?.();
            onClose();
        },
        [onClose, onFinish],
    );

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') dismiss(false);
            if (event.key === 'ArrowRight' && !last) setIndex((i) => i + 1);
            if (event.key === 'ArrowLeft' && index > 0) setIndex((i) => i - 1);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, index, last, dismiss]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduce ? 0 : 0.2 }}
                    className="fixed inset-0 z-[60] grid place-items-center bg-black/50 px-4 backdrop-blur-sm"
                >
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="tour-title"
                        initial={{ opacity: 0, y: 12, scale: 0.985 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.985 }}
                        transition={{ duration: reduce ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
                        className="w-full max-w-md overflow-hidden rounded-2xl border border-border-subtle bg-surface-raised shadow-[var(--shadow-panel)]"
                    >
                        {/* Skip stays reachable on every step, never buried on the last one. */}
                        <div className="flex items-center justify-between px-5 pt-4">
                            <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-text-muted">
                                {index + 1} of {STEPS.length}
                            </span>
                            <button
                                onClick={() => dismiss(false)}
                                className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-text-muted outline-none ring-accent-line transition-colors hover:text-text-primary focus-visible:ring-2"
                            >
                                Skip
                                <X size={13} />
                            </button>
                        </div>

                        <AnimatePresence mode="wait">
                            <motion.div
                                key={index}
                                initial={{ opacity: 0, x: reduce ? 0 : 14 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: reduce ? 0 : -14 }}
                                transition={{ duration: reduce ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
                                className="px-5 pb-1 pt-3"
                            >
                                <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-accent">
                                    {step.icon}
                                </div>
                                <h2
                                    id="tour-title"
                                    className="mt-3.5 font-display text-[19px] font-semibold leading-snug tracking-tight text-text-primary"
                                >
                                    {step.title}
                                </h2>
                                <p className="mt-2 text-[13.5px] leading-relaxed text-text-secondary">
                                    {step.body}
                                </p>
                                <div className="mt-4 grid min-h-[72px] place-items-center rounded-xl border border-border-subtle bg-surface-sunken px-4 py-4">
                                    {step.visual}
                                </div>
                            </motion.div>
                        </AnimatePresence>

                        <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-4">
                            <div className="flex items-center gap-1.5" aria-hidden>
                                {STEPS.map((entry, dot) => (
                                    <button
                                        key={entry.title}
                                        onClick={() => setIndex(dot)}
                                        aria-label={`Step ${dot + 1}`}
                                        className={`h-1.5 rounded-full outline-none ring-accent-line transition-all focus-visible:ring-2 motion-reduce:transition-none ${
                                            dot === index
                                                ? 'w-5 bg-accent'
                                                : 'w-1.5 bg-border-strong hover:bg-text-muted'
                                        }`}
                                    />
                                ))}
                            </div>

                            <div className="flex items-center gap-2">
                                {index > 0 && (
                                    <button
                                        onClick={() => setIndex((i) => i - 1)}
                                        className="rounded-lg px-3 py-2 text-[12.5px] font-medium text-text-secondary outline-none ring-accent-line transition-colors hover:text-text-primary focus-visible:ring-2"
                                    >
                                        Back
                                    </button>
                                )}
                                <button
                                    onClick={() => (last ? dismiss(true) : setIndex((i) => i + 1))}
                                    className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[12.5px] font-semibold text-white outline-none ring-accent-line transition-opacity hover:opacity-90 focus-visible:ring-2"
                                >
                                    {last ? (
                                        <>
                                            <FileCode size={14} />
                                            Start
                                        </>
                                    ) : (
                                        'Next'
                                    )}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
