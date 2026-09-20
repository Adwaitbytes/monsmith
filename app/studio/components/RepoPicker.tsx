'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Github, Loader2, Lock, Search, X } from 'lucide-react';

import type { RepoSummary } from '@/lib/github/source';

/**
 * Choosing which repository to audit.
 *
 * The picker only exists because people have more than one repository, which is
 * the whole reason a bare "connect GitHub" button is not enough. It is
 * deliberately not a step in a wizard: it opens, you pick, it closes, and the
 * audit starts. Nothing in here asks a second question.
 *
 * Repositories are sorted by when they were last pushed to rather than by name,
 * because the one someone wants to audit is almost always the one they were
 * working in this week. Sorting alphabetically would put a repository called
 * `abandoned-experiment` above the thing they came here for.
 *
 * The unconnected state is part of this component rather than a separate screen.
 * Someone who opens the picker has already decided they want to import from
 * GitHub, so the connect step belongs right here, in the place where that
 * decision was made.
 */

export interface RepoPickerProps {
    open: boolean;
    onClose: () => void;
    /** Null until the status call answers. */
    connected: boolean | null;
    /** Where GitHub installs the app. Absent when the App is not configured. */
    installUrl: string | null;
    /** Signing in is the fix, not an environment variable. */
    signedIn: boolean;
    /** False means the GitHub App genuinely is not set up on this deployment. */
    appAvailable: boolean;
    repos: RepoSummary[];
    loading: boolean;
    error: string | null;
    onPick: (repo: RepoSummary) => void;
    /** Falls back to pasting a URL, which needs no account at all. */
    onPasteInstead: () => void;
}

function relativeTime(iso: string | null): string {
    if (iso === null) return '';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';

    const minutes = Math.round((Date.now() - then) / 60_000);
    if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 31) return `${days}d ago`;
    const months = Math.round(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.round(months / 12)}y ago`;
}

export function RepoPicker(props: RepoPickerProps) {
    /*
      The body is a separate component so that closing the picker unmounts it.

      Query text and the highlighted row have to be clean every time this opens.
      Clearing them from an effect works but clears them a render late, and the
      linter is right to call that out: it is a second render scheduled for a
      change nobody asked for. Unmounting resets them with no effect at all.
    */
    return (
        <AnimatePresence>
            {props.open && <PickerBody {...props} />}
        </AnimatePresence>
    );
}

function PickerBody({
    onClose,
    connected,
    installUrl,
    signedIn,
    appAvailable,
    repos,
    loading,
    error,
    onPick,
    onPasteInstead,
}: RepoPickerProps) {
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const restoreRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        restoreRef.current = document.activeElement as HTMLElement | null;
        const frame = requestAnimationFrame(() => inputRef.current?.focus());
        return () => {
            cancelAnimationFrame(frame);
            restoreRef.current?.focus();
        };
    }, []);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (needle.length === 0) return repos;
        return repos.filter(
            (repo) =>
                repo.fullName.toLowerCase().includes(needle) ||
                (repo.description ?? '').toLowerCase().includes(needle),
        );
    }, [repos, query]);

    /*
      Clamped during render rather than reset from an effect.

      Filtering can shrink the list under a selection that was valid a keystroke
      ago. Correcting that in an effect means one render where the highlight
      points past the end of the list, which is exactly when a keypress would
      land on nothing. Deriving it leaves no such frame.
    */
    const activeIndex = filtered.length === 0 ? 0 : Math.min(active, filtered.length - 1);

    // Keeping the highlighted row on screen is the difference between arrow
    // keys being usable and being theatre.
    useEffect(() => {
        const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
        node?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
        }
        if (filtered.length === 0) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((current) => (Math.min(current, filtered.length - 1) + 1) % filtered.length);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive(
                (current) =>
                    (Math.min(current, filtered.length - 1) - 1 + filtered.length) %
                    filtered.length,
            );
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const repo = filtered[activeIndex];
            if (repo !== undefined) onPick(repo);
        }
    };

    return (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    onClick={onClose}
                    className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm motion-reduce:transition-none"
                >
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-label="Choose a repository"
                        initial={{ opacity: 0, y: -8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.98 }}
                        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={onKeyDown}
                        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border-subtle bg-surface-raised shadow-[var(--shadow-panel)] motion-reduce:transition-none"
                    >
                        <div className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-3">
                            <Github size={16} className="shrink-0 text-text-secondary" />
                            <h2 className="flex-1 font-display text-[14px] font-semibold text-text-primary">
                                Choose a repository
                            </h2>
                            <button
                                onClick={onClose}
                                aria-label="Close"
                                className="rounded-md p-1 text-text-muted outline-none ring-accent-line transition-colors hover:text-text-primary focus-visible:ring-2"
                            >
                                <X size={15} />
                            </button>
                        </div>

                        {connected === true && (
                            <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
                                <Search size={14} className="shrink-0 text-text-muted" />
                                <input
                                    ref={inputRef}
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder="Filter by name"
                                    aria-label="Filter repositories"
                                    className="w-full bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted"
                                />
                            </div>
                        )}

                        <div ref={listRef} className="max-h-[46vh] overflow-y-auto">
                            {connected === null && (
                                <p className="flex items-center gap-2 px-4 py-8 text-[13px] text-text-muted">
                                    <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
                                    Checking your GitHub connection
                                </p>
                            )}

                            {connected === false && (
                                <div className="px-4 py-6">
                                    <p className="text-[13px] leading-relaxed text-text-secondary">
                                        Connect GitHub to list your repositories, including private
                                        ones. Monsmith asks for read access to repository contents
                                        and nothing else, and you choose which repositories it can
                                        see.
                                    </p>
                                    <div className="mt-5 flex flex-wrap gap-2">
                                        {/*
                                          Three different reasons land here and
                                          they need three different sentences.
                                          Telling a signed-out visitor that the
                                          deployment is misconfigured sends them
                                          to check environment variables that
                                          were never the problem.
                                        */}
                                        {installUrl !== null ? (
                                            <a
                                                href={installUrl}
                                                className="rounded-lg bg-accent px-4 py-2 text-[12.5px] font-semibold text-white outline-none ring-accent-line transition-opacity hover:opacity-90 focus-visible:ring-2"
                                            >
                                                Connect GitHub
                                            </a>
                                        ) : !signedIn ? (
                                            <p className="text-[12.5px] text-text-secondary">
                                                Sign in first. An installation is tied to an account,
                                                so connecting needs one.
                                            </p>
                                        ) : !appAvailable ? (
                                            <p className="text-[12.5px] text-text-muted">
                                                GitHub is not set up on this deployment.
                                            </p>
                                        ) : (
                                            <p className="text-[12.5px] text-text-muted">
                                                Could not reach GitHub just now.
                                            </p>
                                        )}
                                        <button
                                            onClick={onPasteInstead}
                                            className="rounded-lg border border-border-subtle px-4 py-2 text-[12.5px] font-medium text-text-secondary outline-none ring-accent-line transition-colors hover:border-border-strong hover:text-text-primary focus-visible:ring-2"
                                        >
                                            Paste a public URL instead
                                        </button>
                                    </div>
                                </div>
                            )}

                            {connected === true && loading && (
                                <p className="flex items-center gap-2 px-4 py-8 text-[13px] text-text-muted">
                                    <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
                                    Loading your repositories
                                </p>
                            )}

                            {connected === true && !loading && error !== null && (
                                <p className="px-4 py-6 text-[13px] leading-relaxed text-text-secondary">
                                    {error}
                                </p>
                            )}

                            {connected === true && !loading && error === null && filtered.length === 0 && (
                                <p className="px-4 py-8 text-[13px] text-text-muted">
                                    {repos.length === 0
                                        ? 'No repositories were shared with Monsmith yet.'
                                        : 'Nothing matches that.'}
                                </p>
                            )}

                            {filtered.map((repo, index) => (
                                <button
                                    key={repo.fullName}
                                    data-index={index}
                                    onMouseEnter={() => setActive(index)}
                                    onClick={() => onPick(repo)}
                                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors ${
                                        index === activeIndex ? 'bg-accent-soft' : 'hover:bg-surface-sunken'
                                    }`}
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-text-primary">
                                            {repo.fullName}
                                            {repo.private && (
                                                <Lock size={11} className="shrink-0 text-text-muted" />
                                            )}
                                        </p>
                                        {repo.description !== null && (
                                            <p className="truncate text-[11.5px] text-text-muted">
                                                {repo.description}
                                            </p>
                                        )}
                                    </div>
                                    <span className="shrink-0 font-mono text-[10.5px] text-text-muted">
                                        {relativeTime(repo.pushedAt)}
                                    </span>
                                </button>
                            ))}
                        </div>

                        {connected === true && (
                            <div className="border-t border-border-subtle px-4 py-2.5">
                                <button
                                    onClick={onPasteInstead}
                                    className="text-[11.5px] text-text-muted outline-none ring-accent-line transition-colors hover:text-text-secondary focus-visible:ring-2"
                                >
                                    Or paste any public repository URL
                                </button>
                            </div>
                        )}
                    </motion.div>
                </motion.div>
    );
}
