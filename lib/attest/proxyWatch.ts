import 'server-only';

import { neon } from '@neondatabase/serverless';

/**
 * Proxies Monsmith has been asked about, and every time one changed.
 *
 * Every upgrade of an EIP-1967 proxy rewrites its implementation slot and emits
 * `Upgraded`. Monsmith reads that slot whenever someone verifies the proxy, and
 * on a schedule for every proxy it has seen, so an upgrade is noticed even when
 * nobody happens to ask, and the verifier can say "this changed since it was
 * last checked" instead of quietly answering about the new code as if it were
 * the old.
 */

function client() {
    const url = process.env.DATABASE_URL;
    if (url === undefined || url.length === 0) return null;
    return neon(url);
}

let provisioned = false;

async function ensureSchema(): Promise<void> {
    if (provisioned) return;
    const sql = client();
    if (sql === null) return;
    await sql`
        CREATE TABLE IF NOT EXISTS proxy_watch (
            chain_id        INTEGER     NOT NULL,
            proxy           TEXT        NOT NULL,
            implementation  TEXT        NOT NULL,
            checked_block   BIGINT      NOT NULL,
            first_seen      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (chain_id, proxy)
        )
    `;
    await sql`
        CREATE TABLE IF NOT EXISTS proxy_upgrades (
            chain_id            INTEGER     NOT NULL,
            proxy               TEXT        NOT NULL,
            from_implementation TEXT        NOT NULL,
            to_implementation   TEXT        NOT NULL,
            seen_block          BIGINT      NOT NULL,
            seen_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS proxy_upgrades_proxy ON proxy_upgrades (chain_id, proxy, seen_at DESC)`;
    provisioned = true;
}

export interface ProxyUpgrade {
    from: string;
    to: string;
    seenBlock: string;
    seenAt: string;
}

/**
 * Records what a proxy points at now and returns the upgrade, if this read is
 * the first to see a new implementation. A read at an older block than the one
 * already recorded never moves the record backwards.
 */
export async function observeProxy(chainId: number, proxy: string, implementation: string, block: bigint): Promise<ProxyUpgrade | null> {
    const sql = client();
    if (sql === null) return null;
    await ensureSchema();
    const key = proxy.toLowerCase();
    const impl = implementation.toLowerCase();

    const before = (await sql`
        SELECT implementation, checked_block FROM proxy_watch WHERE chain_id = ${chainId} AND proxy = ${key}
    `) as Array<{ implementation: string; checked_block: string }>;
    const previous = before[0];

    if (previous === undefined) {
        await sql`
            INSERT INTO proxy_watch (chain_id, proxy, implementation, checked_block)
            VALUES (${chainId}, ${key}, ${impl}, ${block.toString()})
            ON CONFLICT (chain_id, proxy) DO NOTHING
        `;
        return null;
    }
    if (BigInt(previous.checked_block) > block) return null;

    const updated = (await sql`
        UPDATE proxy_watch SET implementation = ${impl}, checked_block = ${block.toString()}, checked_at = NOW()
        WHERE chain_id = ${chainId} AND proxy = ${key} AND checked_block <= ${block.toString()}
        RETURNING 1
    `) as unknown[];
    if (updated.length === 0 || previous.implementation === impl) return null;

    await sql`
        INSERT INTO proxy_upgrades (chain_id, proxy, from_implementation, to_implementation, seen_block)
        VALUES (${chainId}, ${key}, ${previous.implementation}, ${impl}, ${block.toString()})
    `;
    return { from: previous.implementation, to: impl, seenBlock: block.toString(), seenAt: new Date().toISOString() };
}

/** The most recent upgrade Monsmith saw on a proxy, or null. */
export async function lastUpgrade(chainId: number, proxy: string): Promise<ProxyUpgrade | null> {
    const sql = client();
    if (sql === null) return null;
    await ensureSchema();
    const rows = (await sql`
        SELECT from_implementation, to_implementation, seen_block, seen_at FROM proxy_upgrades
        WHERE chain_id = ${chainId} AND proxy = ${proxy.toLowerCase()}
        ORDER BY seen_at DESC LIMIT 1
    `) as Array<{ from_implementation: string; to_implementation: string; seen_block: string; seen_at: string }>;
    const row = rows[0];
    if (row === undefined) return null;
    return { from: row.from_implementation, to: row.to_implementation, seenBlock: String(row.seen_block), seenAt: new Date(row.seen_at).toISOString() };
}

/** Proxies to re-read on the schedule, least recently checked first. */
export async function watchedProxies(limit: number): Promise<Array<{ chainId: number; proxy: string }>> {
    const sql = client();
    if (sql === null) return [];
    await ensureSchema();
    const rows = (await sql`
        SELECT chain_id, proxy FROM proxy_watch ORDER BY checked_at ASC LIMIT ${limit}
    `) as Array<{ chain_id: number; proxy: string }>;
    return rows.map((row) => ({ chainId: row.chain_id, proxy: row.proxy }));
}
