'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

import { decodeShare, parseShareFragment, SHARE_VIEW_LABELS, type ShareView } from '@/lib/shareLink';
import { ChainFitReport } from '../studio/components/ChainFitReport';
import { GasProfiler } from '../studio/components/GasProfiler';
import { ParallelProfiler } from '../studio/components/ParallelProfiler';
import { MonsmithMark } from '../landing/MonsmithMark';

/**
 * Renders an analysis someone was sent.
 *
 * The contract arrives in the URL fragment, so this has to run in the browser:
 * the server never sees the link's payload, which is the point. It then hands
 * the source to exactly the same panel components the studio uses, rather than
 * a read-only copy of them, so a shared report can never disagree with what the
 * sender was looking at.
 */

type Status = 'reading' | 'ready' | 'invalid';

export function ShareClient() {
    const [status, setStatus] = useState<Status>('reading');
    const [view, setView] = useState<ShareView>('chainfit');
    const [source, setSource] = useState('');

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            const target = parseShareFragment(window.location.hash);
            if (target === null) {
                if (!cancelled) setStatus('invalid');
                return;
            }

            const decoded = await decodeShare(target.source);
            if (cancelled) return;

            if (decoded === null || decoded.trim().length === 0) {
                setStatus('invalid');
                return;
            }

            setView(target.view);
            setSource(decoded);
            setStatus('ready');
        };

        void load();
        // A pasted fragment can change without a navigation, so react to it.
        window.addEventListener('hashchange', load);
        return () => {
            cancelled = true;
            window.removeEventListener('hashchange', load);
        };
    }, []);

    return (
        <main className="flex h-screen flex-col bg-background text-text-primary">
            <nav className="flex shrink-0 items-center justify-between border-b border-border-subtle px-5 py-3">
                <Link href="/" className="flex items-center gap-2.5">
                    <MonsmithMark className="h-5 w-5" />
                    <span className="font-display text-[14px] font-semibold tracking-tight">Monsmith</span>
                </Link>
                <div className="flex items-center gap-3">
                    {status === 'ready' && (
                        <span className="hidden text-[12px] text-text-muted sm:inline">
                            Shared {SHARE_VIEW_LABELS[view].toLowerCase()}
                        </span>
                    )}
                    <Link
                        href="/studio"
                        className="rounded-lg bg-text-primary px-3.5 py-1.5 text-[12.5px] font-semibold text-background transition-opacity hover:opacity-90"
                    >
                        Open in studio
                    </Link>
                </div>
            </nav>

            {status === 'reading' && (
                <div className="flex flex-1 items-center justify-center">
                    <p className="text-[13px] text-text-muted">Reading the link…</p>
                </div>
            )}

            {status === 'invalid' && (
                <div className="flex flex-1 items-center justify-center px-6">
                    <div className="max-w-md text-center">
                        <h1 className="font-display text-2xl font-semibold tracking-tight">
                            This link has nothing in it
                        </h1>
                        <p className="mt-3 text-[14px] leading-relaxed text-text-secondary">
                            A share link carries the contract inside the address itself, so it can be
                            truncated by a chat client that shortens long URLs. Ask for it again, or
                            paste the contract straight into the studio.
                        </p>
                        <Link
                            href="/studio"
                            className="mt-5 inline-block rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                        >
                            Open the studio
                        </Link>
                    </div>
                </div>
            )}

            {status === 'ready' && (
                <div className="min-h-0 flex-1">
                    {view === 'parallel' && <ParallelProfiler code={source} autoRun />}
                    {view === 'gas' && <GasProfiler code={source} autoRun />}
                    {view === 'chainfit' && <ChainFitReport code={source} autoRun />}
                </div>
            )}
        </main>
    );
}
