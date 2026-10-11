import 'server-only';

import { decodeEventLog, toEventSelector, type Hex } from 'viem';

import { ATTESTATIONS_ABI, type AttestConfig } from './chain';

/**
 * Everything Monsmith has attested, newest first, with running totals.
 *
 * The contract keeps only the latest attestation per source; the history is
 * in its event log, and the public Monad RPC will not hand that log over in
 * one piece: it answers eth_getLogs over at most 100 blocks, and Monad makes
 * about 216,000 a day. So the ledger is read through Envio. The hosted
 * HyperIndex indexer in /indexer is the first choice, since it has already
 * done the work; HyperSync, which returns the whole log in a request or two,
 * stands behind it.
 */

export interface LedgerEntry {
    sourceHash: string;
    auditedChainId: number;
    target: string;
    score: number;
    critical: number;
    high: number;
    reportURI: string;
    reattested: boolean;
    timestamp: number;
    txHash: string;
}

export interface LedgerStats {
    attestations: number;
    sources: number;
    deployments: number;
    averageScore: number | null;
    criticalFound: number;
    highFound: number;
}

export interface Ledger {
    via: 'envio-hyperindex' | 'envio-hypersync';
    stats: LedgerStats;
    recent: LedgerEntry[];
}

const ZERO = '0x0000000000000000000000000000000000000000';
/** The block MonsmithAttestations was deployed in. Nothing older can hold its events. */
export const DEPLOY_BLOCK = 112_388_073;
const RECENT = 25;

function statsOf(entries: readonly Omit<LedgerEntry, 'reattested'>[]): LedgerStats {
    const sources = new Set(entries.map((entry) => entry.sourceHash));
    const deployments = new Set(
        entries.filter((entry) => entry.target.toLowerCase() !== ZERO).map((entry) => `${entry.auditedChainId}_${entry.target.toLowerCase()}`),
    );
    return {
        attestations: entries.length,
        sources: sources.size,
        deployments: deployments.size,
        averageScore: entries.length === 0 ? null : Math.round(entries.reduce((sum, entry) => sum + entry.score, 0) / entries.length),
        criticalFound: entries.reduce((sum, entry) => sum + entry.critical, 0),
        highFound: entries.reduce((sum, entry) => sum + entry.high, 0),
    };
}

/** Oldest-first entries with `reattested` filled in, as the indexer computes it. */
export function withHistory(entries: readonly Omit<LedgerEntry, 'reattested'>[]): LedgerEntry[] {
    const seen = new Set<string>();
    return entries.map((entry) => {
        const reattested = seen.has(entry.sourceHash);
        seen.add(entry.sourceHash);
        return { ...entry, reattested };
    });
}

// ============= HYPERINDEX =============

interface IndexedRow {
    sourceHash: string;
    auditedChainId: string | number;
    target: string;
    score: number;
    critical: number;
    high: number;
    reportURI: string;
    reattested: boolean;
    timestamp: number;
    txHash: string;
}

interface IndexedStats {
    attestations: number;
    sources: number;
    deployments: number;
    scoreSum: number;
    criticalFound: number;
    highFound: number;
}

const LEDGER_QUERY = `query Ledger($limit: Int!) {
  Attestation(order_by: [{ blockNumber: desc }, { id: desc }], limit: $limit) {
    sourceHash auditedChainId target score critical high reportURI reattested timestamp txHash
  }
  AgentStats(where: { id: { _eq: "monsmith" } }) {
    attestations sources deployments scoreSum criticalFound highFound
  }
}`;

async function fromHyperIndex(url: string): Promise<Ledger> {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: LEDGER_QUERY, variables: { limit: RECENT } }),
        signal: AbortSignal.timeout(10_000),
        cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HyperIndex answered ${response.status}`);
    const body = (await response.json()) as { data?: { Attestation?: IndexedRow[]; AgentStats?: IndexedStats[] }; errors?: Array<{ message: string }> };
    if (body.errors !== undefined && body.errors.length > 0) throw new Error(`HyperIndex: ${body.errors[0]?.message ?? 'query failed'}`);
    const rows = body.data?.Attestation ?? [];
    const totals = body.data?.AgentStats?.[0];
    return {
        via: 'envio-hyperindex',
        stats:
            totals === undefined
                ? statsOf([])
                : {
                      attestations: totals.attestations,
                      sources: totals.sources,
                      deployments: totals.deployments,
                      averageScore: totals.attestations === 0 ? null : Math.round(totals.scoreSum / totals.attestations),
                      criticalFound: totals.criticalFound,
                      highFound: totals.highFound,
                  },
        recent: rows.map((row) => ({ ...row, auditedChainId: Number(row.auditedChainId) })),
    };
}

// ============= HYPERSYNC =============

const HYPERSYNC_URL = 'https://monad.hypersync.xyz/query';
const ATTESTED_TOPIC = toEventSelector(
    'Attested(bytes32,uint256,address,uint8,uint16,uint16,bytes32,string)',
);

interface HyperSyncLog {
    block_number?: number | string;
    transaction_hash?: string;
    data?: string;
    topic0?: string | null;
    topic1?: string | null;
    topic2?: string | null;
    topic3?: string | null;
}

interface HyperSyncBlock {
    number?: number | string;
    timestamp?: number | string;
}

interface HyperSyncBatch {
    logs?: HyperSyncLog[];
    blocks?: HyperSyncBlock[];
}

interface HyperSyncResponse {
    data?: HyperSyncBatch[] | HyperSyncBatch;
    archive_height?: number;
    next_block?: number;
}

function asNumber(value: number | string | undefined): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return value.startsWith('0x') ? Number(BigInt(value)) : Number(value);
    return Number.NaN;
}

/** Decodes one HyperSync page into ledger entries, oldest first. Exported for tests. */
export function decodeHyperSyncPage(page: HyperSyncResponse): Omit<LedgerEntry, 'reattested'>[] {
    const batches = Array.isArray(page.data) ? page.data : page.data === undefined ? [] : [page.data];
    const times = new Map<number, number>();
    for (const block of batches.flatMap((batch) => batch.blocks ?? [])) {
        times.set(asNumber(block.number), asNumber(block.timestamp));
    }
    const entries: Array<Omit<LedgerEntry, 'reattested'> & { block: number }> = [];
    for (const log of batches.flatMap((batch) => batch.logs ?? [])) {
        const topics = [log.topic0, log.topic1, log.topic2, log.topic3].filter((topic): topic is string => typeof topic === 'string' && topic.length > 0);
        if (topics[0]?.toLowerCase() !== ATTESTED_TOPIC || log.data === undefined) continue;
        const decoded = decodeEventLog({
            abi: ATTESTATIONS_ABI,
            data: log.data as Hex,
            topics: topics as [Hex, ...Hex[]],
        });
        if (decoded.eventName !== 'Attested') continue;
        const block = asNumber(log.block_number);
        entries.push({
            block,
            sourceHash: decoded.args.sourceHash,
            auditedChainId: Number(decoded.args.chainId),
            target: decoded.args.target,
            score: decoded.args.score,
            critical: decoded.args.critical,
            high: decoded.args.high,
            reportURI: decoded.args.reportURI,
            timestamp: times.get(block) ?? 0,
            txHash: log.transaction_hash ?? '',
        });
    }
    return entries.sort((a, b) => a.block - b.block).map(({ block: _block, ...entry }) => entry);
}

async function fromHyperSync(config: AttestConfig, token: string): Promise<Ledger> {
    const entries: Omit<LedgerEntry, 'reattested'>[] = [];
    let from = DEPLOY_BLOCK;
    // A page ends where HyperSync stopped scanning; a handful of pages covers
    // months of history, and the cap keeps a misbehaving answer from looping.
    for (let page = 0; page < 20; page++) {
        const response = await fetch(HYPERSYNC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                from_block: from,
                logs: [{ address: [config.address], topics: [[ATTESTED_TOPIC]] }],
                field_selection: {
                    log: ['block_number', 'transaction_hash', 'data', 'topic0', 'topic1', 'topic2', 'topic3'],
                    block: ['number', 'timestamp'],
                },
            }),
            signal: AbortSignal.timeout(10_000),
            cache: 'no-store',
        });
        if (!response.ok) throw new Error(`HyperSync answered ${response.status}: ${(await response.text()).slice(0, 160)}`);
        const body = (await response.json()) as HyperSyncResponse;
        entries.push(...decodeHyperSyncPage(body));
        const next = body.next_block;
        const height = body.archive_height;
        if (next === undefined || next <= from || (height !== undefined && next >= height)) break;
        from = next;
    }
    const history = withHistory(entries);
    return { via: 'envio-hypersync', stats: statsOf(history), recent: history.slice(-RECENT).reverse() };
}

/** The ledger, or null when neither Envio source is configured. */
export async function readLedger(config: AttestConfig): Promise<Ledger | null> {
    const graphql = process.env.ENVIO_GRAPHQL_URL;
    const token = process.env.ENVIO_API_TOKEN;
    if (graphql !== undefined && graphql.length > 0) {
        try {
            return await fromHyperIndex(graphql);
        } catch (error) {
            if (token === undefined || token.length === 0) throw error;
            console.warn('[ledger] HyperIndex failed, reading HyperSync instead:', error instanceof Error ? error.message : error);
        }
    }
    if (token !== undefined && token.length > 0) return fromHyperSync(config, token);
    return null;
}
