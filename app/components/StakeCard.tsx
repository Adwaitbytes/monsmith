'use client';

import { useEffect, useState } from 'react';
import { Coins, Users } from 'lucide-react';

/**
 * What is at stake in a deployed contract, from Nansen: what it holds now and
 * who it has dealt with in the last month, labelled. Placed beside an audit so
 * a finding is weighed by the money behind it.
 *
 * Hidden when there is nothing to say (no Nansen setup, a chain Nansen does not
 * cover, or a failed read), because an empty "$0 at stake" would read as a
 * fact when it is only an absence of data.
 */

interface Stake {
    heldUsd: number;
    holdings: Array<{ symbol: string; amount: number; valueUsd: number }>;
    counterparties: Array<{ address: string; label: string | null; interactions: number; volumeUsd: number }>;
    labelledVolumeShare: number | null;
    windowDays: number;
}

const usd = (value: number) =>
    value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `$${(value / 1_000).toFixed(1)}k` : `$${value.toFixed(0)}`;

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function StakeCard({ chainId, address, severe }: { chainId: number; address: string; severe?: number }) {
    const [stake, setStake] = useState<Stake | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        fetch(`/api/stake?chainId=${chainId}&address=${address}`, { signal: controller.signal })
            .then((response) => (response.ok ? (response.json() as Promise<Stake>) : null))
            .then(setStake)
            .catch((error: unknown) => {
                if (!(error instanceof DOMException && error.name === 'AbortError')) setStake(null);
            });
        return () => controller.abort();
    }, [chainId, address]);

    if (stake === null || (stake.heldUsd === 0 && stake.counterparties.length === 0)) return null;

    const labelled = stake.counterparties.filter((party) => party.label !== null);

    return (
        <section className="mt-4 rounded-2xl border border-border-subtle bg-surface-raised p-5" aria-label="What is at stake">
            <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[13px] font-semibold">What is at stake</h3>
                <span className="text-[11px] text-text-muted">Onchain intelligence by Nansen</span>
            </div>

            {severe !== undefined && severe > 0 && stake.heldUsd > 0 && (
                <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/[0.07] px-3 py-2 text-[12.5px] text-text-secondary">
                    {severe} critical or high {severe === 1 ? 'finding sits' : 'findings sit'} on a contract holding {usd(stake.heldUsd)}.
                </p>
            )}

            <dl className="mt-3 grid grid-cols-2 gap-3">
                <div>
                    <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-text-muted">
                        <Coins size={12} aria-hidden /> Held now
                    </dt>
                    <dd className="mt-0.5 font-mono text-[20px] font-semibold tabular-nums">{usd(stake.heldUsd)}</dd>
                    {stake.holdings.length > 0 && (
                        <p className="text-[11.5px] text-text-muted">{stake.holdings.slice(0, 3).map((holding) => `${holding.symbol} ${usd(holding.valueUsd)}`).join(' · ')}</p>
                    )}
                </div>
                <div>
                    <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-text-muted">
                        <Users size={12} aria-hidden /> Counterparties, {stake.windowDays} days
                    </dt>
                    <dd className="mt-0.5 font-mono text-[20px] font-semibold tabular-nums">{stake.counterparties.length}</dd>
                    {stake.labelledVolumeShare !== null && (
                        <p className="text-[11.5px] text-text-muted">{Math.round(stake.labelledVolumeShare * 100)}% of volume from labelled wallets</p>
                    )}
                </div>
            </dl>

            {labelled.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-border-subtle pt-3">
                    {labelled.slice(0, 4).map((party) => (
                        <li key={party.address} className="flex items-baseline justify-between gap-3 text-[12px]">
                            <span className="min-w-0 truncate text-text-secondary" title={party.address}>
                                {party.label} <span className="font-mono text-text-muted">{short(party.address)}</span>
                            </span>
                            <span className="shrink-0 font-mono tabular-nums text-text-muted">{usd(party.volumeUsd)}</span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
