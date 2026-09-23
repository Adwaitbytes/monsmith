import 'server-only';

import { neon } from '@neondatabase/serverless';

import type { ReportOrigin, RepoReport } from './types';

/**
 * Persistence for reports and their unlocks.
 *
 * A report is worth storing for three reasons: it takes up to five minutes of
 * compute to produce and nobody should pay that twice, it needs a permalink to
 * be shareable, and the paid half has to live somewhere the browser has never
 * seen. That last one is the load-bearing reason. The full report is written
 * here and only ever leaves through `redactReport`.
 *
 * Tables are provisioned on first use rather than through a migration runner,
 * because this codebase has no migration runner and inventing one to add three
 * tables would be the larger change. `analyticsConfigured()` sets the precedent
 * that a missing `DATABASE_URL` degrades to a working app, so every function
 * here tolerates an unconfigured deployment: reports simply become
 * session-scoped and unshareable rather than erroring.
 */

function client() {
    const url = process.env.DATABASE_URL;
    if (url === undefined || url.length === 0) return null;
    return neon(url);
}

export function reportStoreConfigured(): boolean {
    const url = process.env.DATABASE_URL;
    return url !== undefined && url.length > 0;
}

let provisioned = false;

/** Creates the tables once per process. Cheap enough to await on every call. */
async function ensureSchema(): Promise<void> {
    if (provisioned) return;
    const sql = client();
    if (sql === null) return;

    await sql`
        CREATE TABLE IF NOT EXISTS reports (
            report_id    TEXT PRIMARY KEY,
            user_id      TEXT,
            visitor_id   TEXT,
            origin       JSONB       NOT NULL,
            payload      JSONB       NOT NULL,
            health_score INTEGER,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `;
    await sql`
        CREATE TABLE IF NOT EXISTS report_unlocks (
            report_id  TEXT PRIMARY KEY,
            user_id    TEXT,
            visitor_id TEXT,
            tx_hash    TEXT,
            amount_wei TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `;
    await sql`
        CREATE TABLE IF NOT EXISTS github_installations (
            installation_id BIGINT      PRIMARY KEY,
            user_id         TEXT        NOT NULL,
            account_login   TEXT,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS reports_owner ON reports (user_id, created_at DESC)`;
    await sql`
        CREATE INDEX IF NOT EXISTS github_installations_user
            ON github_installations (user_id)
    `;

    provisioned = true;
}

export interface ReportOwner {
    userId: string | null;
    visitorId: string | null;
}

export async function saveReport(report: RepoReport, owner: ReportOwner): Promise<void> {
    const sql = client();
    if (sql === null) return;
    await ensureSchema();

    await sql`
        INSERT INTO reports (report_id, user_id, visitor_id, origin, payload, health_score)
        VALUES (
            ${report.reportId},
            ${owner.userId},
            ${owner.visitorId},
            ${JSON.stringify(report.origin)},
            ${JSON.stringify(report)},
            ${report.health?.score ?? null}
        )
        ON CONFLICT (report_id) DO UPDATE
            SET payload      = EXCLUDED.payload,
                health_score = EXCLUDED.health_score
    `;
}

export interface StoredReport {
    report: RepoReport;
    owner: ReportOwner;
    origin: ReportOrigin;
    createdAt: string;
}

export async function loadReport(reportId: string): Promise<StoredReport | null> {
    const sql = client();
    if (sql === null) return null;
    await ensureSchema();

    const rows = (await sql`
        SELECT payload, user_id, visitor_id, origin, created_at
        FROM reports
        WHERE report_id = ${reportId}
    `) as Array<{
        payload: RepoReport;
        user_id: string | null;
        visitor_id: string | null;
        origin: ReportOrigin;
        created_at: string;
    }>;

    const row = rows[0];
    if (row === undefined) return null;

    return {
        report: row.payload,
        owner: { userId: row.user_id, visitorId: row.visitor_id },
        origin: row.origin,
        createdAt: new Date(row.created_at).toISOString(),
    };
}

/** A row in someone's report history. Summary only: the page lists, not reads. */
export interface ReportSummary {
    reportId: string;
    createdAt: string;
    origin: ReportOrigin;
    healthScore: number | null;
    contracts: number;
    subject: string;
}

/**
 * Reports this owner has produced, newest first.
 *
 * A report that took five minutes of compute and cannot be found again is a
 * report that gets run twice. They were already being stored for the permalink,
 * so the only thing missing was a way back to them, and a list is that.
 *
 * Summaries are assembled here rather than by reading each payload, because a
 * history page that deserialises fifty full reports to render fifty rows is a
 * page that gets slower every time someone uses the product.
 */
export async function reportsFor(
    owner: ReportOwner,
    limit = 50,
): Promise<ReportSummary[]> {
    const sql = client();
    if (sql === null) return [];
    await ensureSchema();

    const key = owner.userId ?? owner.visitorId;
    if (key === null) return [];

    const rows = (await (owner.userId !== null
        ? sql`
            SELECT report_id, origin, health_score, created_at,
                   jsonb_array_length(payload -> 'contracts') AS contract_count,
                   payload -> 'contracts' -> 0 ->> 'name' AS first_name
            FROM reports
            WHERE user_id = ${key}
            ORDER BY created_at DESC
            LIMIT ${limit}
          `
        : sql`
            SELECT report_id, origin, health_score, created_at,
                   jsonb_array_length(payload -> 'contracts') AS contract_count,
                   payload -> 'contracts' -> 0 ->> 'name' AS first_name
            FROM reports
            WHERE visitor_id = ${key}
            ORDER BY created_at DESC
            LIMIT ${limit}
          `)) as Array<{
        report_id: string;
        origin: ReportOrigin;
        health_score: number | null;
        created_at: string;
        contract_count: number | null;
        first_name: string | null;
    }>;

    return rows.map((row) => ({
        reportId: row.report_id,
        createdAt: new Date(row.created_at).toISOString(),
        origin: row.origin,
        healthScore: row.health_score,
        contracts: row.contract_count ?? 0,
        subject: subjectOf(row.origin, row.first_name),
    }));
}

/** What to call a report in a list, from cheapest identifying detail first. */
function subjectOf(origin: ReportOrigin, firstContract: string | null): string {
    if (origin?.kind === 'github') return `${origin.owner}/${origin.repo}`;
    if (origin?.kind === 'address') {
        return `${origin.address.slice(0, 8)}…${origin.address.slice(-4)}`;
    }
    return firstContract ?? 'Workspace';
}

/**
 * Whether a viewer may see the full report.
 *
 * Three ways in, checked cheapest first. A paying tier is unlimited, an explicit
 * unlock row is a settled payment, and the first report an account ever produces
 * is free so that nobody is asked to pay before they have seen the product work
 * once.
 */
export async function isUnlocked(
    reportId: string,
    owner: ReportOwner,
    unlimited: boolean,
): Promise<boolean> {
    if (unlimited) return true;

    const sql = client();
    // With no database there is nothing to settle against and nothing to
    // remember, so an unconfigured deployment shows the full report rather than
    // locking a product it cannot take money for.
    if (sql === null) return true;
    await ensureSchema();

    const unlocks = (await sql`
        SELECT 1 FROM report_unlocks WHERE report_id = ${reportId}
    `) as unknown[];
    if (unlocks.length > 0) return true;

    return isFirstReport(reportId, owner);
}

/** True when this is the earliest report the owner has produced. */
async function isFirstReport(reportId: string, owner: ReportOwner): Promise<boolean> {
    const sql = client();
    if (sql === null) return true;

    const key = owner.userId ?? owner.visitorId;
    if (key === null) return false;

    const column = owner.userId !== null ? 'user_id' : 'visitor_id';
    const rows = (await (column === 'user_id'
        ? sql`SELECT report_id FROM reports WHERE user_id = ${key} ORDER BY created_at ASC LIMIT 1`
        : sql`SELECT report_id FROM reports WHERE visitor_id = ${key} ORDER BY created_at ASC LIMIT 1`)) as Array<{
        report_id: string;
    }>;

    return rows[0]?.report_id === reportId;
}

export async function recordUnlock(
    reportId: string,
    owner: ReportOwner,
    txHash: string | null,
    amountWei: string | null,
): Promise<void> {
    const sql = client();
    if (sql === null) return;
    await ensureSchema();

    await sql`
        INSERT INTO report_unlocks (report_id, user_id, visitor_id, tx_hash, amount_wei)
        VALUES (${reportId}, ${owner.userId}, ${owner.visitorId}, ${txHash}, ${amountWei})
        ON CONFLICT (report_id) DO NOTHING
    `;
}

// ============= GITHUB INSTALLATIONS =============

export async function saveInstallation(
    installationId: number,
    userId: string,
    accountLogin: string | null,
): Promise<void> {
    const sql = client();
    if (sql === null) return;
    await ensureSchema();

    await sql`
        INSERT INTO github_installations (installation_id, user_id, account_login)
        VALUES (${installationId}, ${userId}, ${accountLogin})
        ON CONFLICT (installation_id) DO UPDATE
            SET user_id       = EXCLUDED.user_id,
                account_login = EXCLUDED.account_login
    `;
}

export async function installationsFor(
    userId: string,
): Promise<Array<{ installationId: number; accountLogin: string | null }>> {
    const sql = client();
    if (sql === null) return [];
    await ensureSchema();

    const rows = (await sql`
        SELECT installation_id, account_login
        FROM github_installations
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
    `) as Array<{ installation_id: string | number; account_login: string | null }>;

    return rows.map((row) => ({
        installationId: Number(row.installation_id),
        accountLogin: row.account_login,
    }));
}

export async function removeInstallation(installationId: number): Promise<void> {
    const sql = client();
    if (sql === null) return;
    await ensureSchema();
    await sql`DELETE FROM github_installations WHERE installation_id = ${installationId}`;
}
