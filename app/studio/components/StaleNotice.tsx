'use client';

import React from 'react';
import { RotateCw } from 'lucide-react';

/**
 * Shown above a cached result when the editor has moved on since it was
 * produced.
 *
 * The alternative designs are both worse. Dropping the result on every keystroke
 * means a panel that is empty most of the time, and re-running automatically
 * spends a second of compute on every pause in typing. Keeping the numbers and
 * labelling them lets the reader decide whether the edit they just made
 * invalidates what they were looking at, which is usually a question only they
 * can answer.
 */

export interface StaleNoticeProps {
    /** Epoch millis the cached result was produced. */
    at: number | null;
    onRerun: () => void;
    busy?: boolean;
}

function agoText(at: number): string {
    const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.round(minutes / 60)}h ago`;
}

export function StaleNotice({ at, onRerun, busy = false }: StaleNoticeProps) {
    return (
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <p className="text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-300">
                The contract has changed since this ran{at === null ? '' : ` ${agoText(at)}`}. These
                numbers describe the earlier version.
            </p>
            <button
                onClick={onRerun}
                disabled={busy}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-500/40 px-2.5 py-1 text-[11.5px] font-medium text-amber-700 transition-colors hover:bg-amber-500/15 disabled:opacity-60 dark:text-amber-300"
            >
                <RotateCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} strokeWidth={2} />
                {busy ? 'Running' : 'Run again'}
            </button>
        </div>
    );
}
