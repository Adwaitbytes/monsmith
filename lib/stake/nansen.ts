import 'server-only';

/**
 * What is at stake in a deployed contract, from Nansen.
 *
 * A finding's severity says how bad a bug is in the abstract; what makes it
 * urgent is the money behind it and who that money belongs to. A critical in a
 * test contract holding nothing is a lesson, the same critical in a contract
 * holding two million dollars from labelled funds is an incident waiting to
 * happen. Nansen knows both: what the contract holds now, and who it has been
 * trading with, labelled.
 *
 * Every call spends Nansen credits, so callers cache the answer.
 */

const API = 'https://api.nansen.ai/api/v1/profiler/address';

/** Nansen's chain names for the chains Monsmith audits from. Testnets have no data. */
const CHAINS: Readonly<Record<number, string>> = { 143: 'monad', 1: 'ethereum' };

export function nansenChain(chainId: number): string | null {
    return CHAINS[chainId] ?? null;
}

export interface Holding {
    symbol: string;
    amount: number;
    valueUsd: number;
}

export interface Counterparty {
    address: string;
    label: string | null;
    interactions: number;
    volumeUsd: number;
}

export interface Stake {
    chain: string;
    address: string;
    heldUsd: number;
    holdings: Holding[];
    counterparties: Counterparty[];
    /** Share of counterparty volume that came from wallets Nansen has a label for. */
    labelledVolumeShare: number | null;
    windowDays: number;
}

interface BalanceRow {
    token_symbol?: unknown;
    token_amount?: unknown;
    value_usd?: unknown;
}

interface CounterpartyRow {
    counterparty_address?: unknown;
    counterparty_address_label?: unknown;
    interaction_count?: unknown;
    total_volume_usd?: unknown;
}

const number = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : 0;
};

/** A label Nansen returns as a list, a string or nothing, as one readable string. */
function labelOf(value: unknown): string | null {
    if (Array.isArray(value)) {
        const parts = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
        return parts.length > 0 ? parts.join(', ') : null;
    }
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Turns Nansen's two answers into the stake. Pure, so it is tested without spending credits. */
export function summariseStake(
    chain: string,
    address: string,
    balances: readonly BalanceRow[],
    counterparties: readonly CounterpartyRow[],
    windowDays: number,
): Stake {
    const holdings = balances
        .map((row) => ({ symbol: typeof row.token_symbol === 'string' ? row.token_symbol : '?', amount: number(row.token_amount), valueUsd: number(row.value_usd) }))
        .filter((holding) => holding.valueUsd > 0)
        .sort((a, b) => b.valueUsd - a.valueUsd);
    const parties = counterparties
        .map((row) => ({
            address: typeof row.counterparty_address === 'string' ? row.counterparty_address : '',
            label: labelOf(row.counterparty_address_label),
            interactions: Math.round(number(row.interaction_count)),
            volumeUsd: number(row.total_volume_usd),
        }))
        .filter((party) => party.address.length > 0)
        .sort((a, b) => b.volumeUsd - a.volumeUsd);
    const totalVolume = parties.reduce((sum, party) => sum + party.volumeUsd, 0);
    const labelledVolume = parties.filter((party) => party.label !== null).reduce((sum, party) => sum + party.volumeUsd, 0);
    return {
        chain,
        address,
        heldUsd: holdings.reduce((sum, holding) => sum + holding.valueUsd, 0),
        holdings: holdings.slice(0, 5),
        counterparties: parties.slice(0, 8),
        labelledVolumeShare: totalVolume > 0 ? labelledVolume / totalVolume : null,
        windowDays,
    };
}

async function post<T>(path: string, body: unknown, apiKey: string): Promise<T[]> {
    const response = await fetch(`${API}/${path}`, {
        method: 'POST',
        headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Nansen ${path} answered ${response.status}: ${(await response.text()).slice(0, 160)}`);
    const parsed = (await response.json()) as { data?: unknown };
    return Array.isArray(parsed.data) ? (parsed.data as T[]) : [];
}

const WINDOW_DAYS = 30;

/** The stake in a deployed contract, or null when Nansen is not set up or has no data for the chain. */
export async function stakeOf(chainId: number, address: string, apiKey = process.env.NANSEN_API_KEY): Promise<Stake | null> {
    const chain = nansenChain(chainId);
    if (chain === null || apiKey === undefined || apiKey.length === 0) return null;
    const to = new Date();
    const from = new Date(to.getTime() - WINDOW_DAYS * 86_400_000);
    const day = (date: Date) => date.toISOString().slice(0, 10);
    const [balances, counterparties] = await Promise.all([
        post<BalanceRow>('current-balance', { address, chain, hide_spam_token: true, pagination: { page: 1, per_page: 20 }, order_by: [{ field: 'value_usd', direction: 'DESC' }] }, apiKey),
        post<CounterpartyRow>(
            'counterparties',
            { address, chain, date: { from: day(from), to: day(to) }, group_by: 'wallet', pagination: { page: 1, per_page: 25 }, order_by: [{ field: 'total_volume_usd', direction: 'DESC' }] },
            apiKey,
        ),
    ]);
    return summariseStake(chain, address, balances, counterparties, WINDOW_DAYS);
}
