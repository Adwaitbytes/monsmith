'use client';

import { useEffect, useState } from 'react';
import { BadgeCheck, Loader2, Upload } from 'lucide-react';

import { visitorId } from '@/lib/visitor';

/**
 * Publishing a report onchain, from the report itself.
 *
 * One button: once pressed, the audit's score is attested on Monad mainnet
 * under Monsmith's ERC-8004 identity, and the button becomes a link to the
 * transaction. Hidden entirely where publishing is not set up, so a missing
 * deployment setting never shows as a broken control.
 */

interface Published {
    contractPath: string;
    txHash: string;
    explorerUrl: string;
}

type State =
    | { kind: 'loading' }
    | { kind: 'off' }
    | { kind: 'ready' }
    | { kind: 'publishing' }
    | { kind: 'published'; entries: Published[] }
    | { kind: 'error'; message: string };

const BUTTON =
    'flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] font-medium outline-none ring-accent-line transition-colors focus-visible:ring-2';

export function ReportAttest({ reportId }: { reportId: string }) {
    const [state, setState] = useState<State>({ kind: 'loading' });

    useEffect(() => {
        const controller = new AbortController();
        fetch(`/api/report/${reportId}/attest`, { signal: controller.signal })
            .then((response) => (response.ok ? response.json() : null))
            .then((data: { enabled?: boolean; attestations?: Published[] } | null) => {
                if (data === null || data.enabled !== true) setState({ kind: 'off' });
                else if ((data.attestations ?? []).length > 0) setState({ kind: 'published', entries: data.attestations ?? [] });
                else setState({ kind: 'ready' });
            })
            .catch((error: unknown) => {
                if (error instanceof DOMException && error.name === 'AbortError') return;
                setState({ kind: 'off' });
            });
        return () => controller.abort();
    }, [reportId]);

    const publish = async () => {
        setState({ kind: 'publishing' });
        try {
            const response = await fetch(`/api/report/${reportId}/attest`, {
                method: 'POST',
                headers: { 'x-visitor-id': visitorId() },
            });
            const data = (await response.json()) as { success?: boolean; attestations?: Published[]; error?: string };
            if (!response.ok || data.success !== true) {
                setState({ kind: 'error', message: data.error ?? 'Publishing failed.' });
                return;
            }
            setState({ kind: 'published', entries: data.attestations ?? [] });
        } catch {
            setState({ kind: 'error', message: 'Could not reach the server.' });
        }
    };

    if (state.kind === 'loading' || state.kind === 'off') return null;

    if (state.kind === 'published') {
        const first = state.entries[0];
        return (
            <a
                href={first?.explorerUrl}
                target="_blank"
                rel="noopener"
                title="This audit is attested on Monad mainnet under Monsmith's ERC-8004 agent identity"
                className={`${BUTTON} border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:border-emerald-500/50 dark:text-emerald-300`}
            >
                <BadgeCheck size={12} aria-hidden />
                On Monad
            </a>
        );
    }

    return (
        <button
            type="button"
            onClick={() => void publish()}
            disabled={state.kind === 'publishing'}
            title={state.kind === 'error' ? state.message : 'Attest this audit on Monad mainnet, so wallets and agents can check it onchain'}
            className={`${BUTTON} ${
                state.kind === 'error'
                    ? 'border-red-500/40 text-red-700 dark:text-red-300'
                    : 'border-accent-line text-accent hover:border-accent'
            } disabled:cursor-wait disabled:opacity-70`}
        >
            {state.kind === 'publishing' ? <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Upload size={12} aria-hidden />}
            {state.kind === 'publishing' ? 'Publishing' : state.kind === 'error' ? 'Retry publish' : 'Publish to Monad'}
        </button>
    );
}
