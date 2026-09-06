'use client';

import React, { useCallback, useState } from 'react';
import { Check, Link2, Loader2 } from 'lucide-react';

import { buildShareUrl, type ShareView } from '@/lib/shareLink';

/**
 * Copies a link that reproduces the current analysis for someone else.
 *
 * Disabled until there is a result, because a link to an empty panel is not
 * worth sending. The whole contract travels inside the URL fragment, so the
 * copy is the entire operation: no request, no id to keep, nothing to expire.
 */

export interface ShareButtonProps {
    view: ShareView;
    source: string;
    /** Nothing to share until an analysis has actually run. */
    ready: boolean;
    /** Compact rendering for a dense panel header. */
    compact?: boolean;
}

type State = 'idle' | 'working' | 'copied' | 'error';

export function ShareButton({ view, source, ready, compact = false }: ShareButtonProps) {
    const [state, setState] = useState<State>('idle');
    const [message, setMessage] = useState<string | null>(null);

    const share = useCallback(async () => {
        setState('working');
        setMessage(null);

        const built = await buildShareUrl(window.location.origin, { view, source });
        if ('error' in built) {
            setState('error');
            setMessage(built.error);
            window.setTimeout(() => setState('idle'), 6000);
            return;
        }

        try {
            await navigator.clipboard.writeText(built.url);
            setState('copied');
            window.setTimeout(() => setState('idle'), 2200);
        } catch {
            // Clipboard permission can be refused; showing the URL still lets
            // the reader copy it by hand rather than losing the work.
            setState('error');
            setMessage(built.url);
        }
    }, [view, source]);

    const label =
        state === 'working' ? 'Building' : state === 'copied' ? 'Link copied' : 'Share';

    return (
        <span className="relative inline-flex">
            <button
                onClick={share}
                disabled={!ready || state === 'working'}
                title={
                    ready
                        ? 'Copy a link that reproduces this analysis. The contract travels in the link; nothing is stored.'
                        : 'Run the analysis first'
                }
                className={`flex items-center gap-1.5 rounded-lg border border-border-subtle text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 ${
                    compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-[12px]'
                }`}
            >
                {state === 'working' ? (
                    <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                ) : state === 'copied' ? (
                    <Check className="h-3 w-3 text-emerald-500" strokeWidth={2.5} />
                ) : (
                    <Link2 className="h-3 w-3" strokeWidth={2} />
                )}
                {label}
            </button>

            {state === 'error' && message !== null && (
                <span className="absolute right-0 top-full z-20 mt-1.5 w-64 rounded-lg border border-border-subtle bg-surface-overlay p-2.5 text-[11px] leading-relaxed text-text-secondary shadow-[var(--shadow-panel)]">
                    {message.startsWith('http') ? (
                        <>
                            <span className="text-text-muted">Copy this link:</span>
                            <span className="mt-1 block break-all font-mono text-[10px] text-text-primary">
                                {message}
                            </span>
                        </>
                    ) : (
                        message
                    )}
                </span>
            )}
        </span>
    );
}
