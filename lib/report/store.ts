import 'server-only';

import { neon } from '@neondatabase/serverless';

import { freeAllowanceFor, isFreeReport } from './freeReports';
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
    // Card payments arrived after the MON rail, so the columns that tell the two
    // apart are added rather than declared. A refund finds its unlock through
    // payment_id, which is why that one is unique.
    await sql`ALTER TABLE report_unlocks ADD COLUMN IF NOT EXISTS provider TEXT`;
    await sql`ALTER TABLE report_unlocks ADD COLUMN IF NOT EXISTS payment_id TEXT`;
    await sql`ALTER TABLE report_unlocks ADD COLUMN IF NOT EXISTS amount_minor BIGINT`;
    await sql`ALTER TABLE report_unlocks ADD COLUMN IF NOT EXISTS currency TEXT`;
    await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS report_unlocks_payment
            ON report_unlocks (payment_id) WHERE payment_id IS NOT NULL
    `;
    await sql`
        CREATE TABLE IF NOT EXISTS processed_webhooks (
            webhook_id   TEXT PRIMARY KEY,
            event_type   TEXT        NOT NULL,
            processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    // An optimized contract's report points back at the report it improved on.
    // It is the owner's by right, not one of their free reports, so the
    // allowance count skips anything with this set.
    await sql`ALTER TABLE reports ADD COLUMN IF NOT EXISTS derived_from TEXT`;
    await sql`
        CREATE TABLE IF NOT EXISTS optimizations (
            optimization_id     TEXT PRIMARY KEY,
            report_id           TEXT        NOT NULL,
            optimized_report_id TEXT        NOT NULL,
            user_id             TEXT,
            visitor_id          TEXT,
            free                BOOLEAN     NOT NULL,
            before_score        INTEGER,
            after_score         INTEGER,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS optimizations_user ON optimizations (user_id) WHERE free`;
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

export async function saveReport(report: RepoReport, owner: ReportOwner, derivedFrom: string | null = null): Promise<void> {
    const sql = client();
    if (sql === null) return;
    await ensureSchema();

    await sql`
        INSERT INTO reports (report_id, user_id, visitor_id, origin, payload, health_score, derived_from)
        VALUES (
            ${report.reportId},
            ${owner.userId},
            ${owner.visitorId},
            ${JSON.stringify(report.origin)},
            ${JSON.stringify(report)},
            ${report.health?.score ?? null},
            ${derivedFrom}
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
 * unlock row is a settled payment, and an owner's first reports (FREE_REPORTS,
 * two by default) are free so that nobody is asked to pay before they have seen
 * the product work on their own code.
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

    return isWithinFreeAllowance(reportId, owner);
}

/**
 * True when this is one of the earliest reports a signed-in owner produced.
 *
 * Free reports need an account (see `freeAllowanceFor`), so a signed-out visitor
 * never gets here with an allowance. Reports a person ran before signing in are
 * adopted by their account first, so trying the product signed out and then
 * signing in does not cost them their free reports.
 */
async function isWithinFreeAllowance(reportId: string, owner: ReportOwner): Promise<boolean> {
    const sql = client();
    if (sql === null) return true;

    const allowance = freeAllowanceFor(owner);
    if (allowance === 0 || owner.userId === null) return false;

    if (owner.visitorId !== null) await adoptVisitorReports(owner.userId, owner.visitorId);

    const rows = (await sql`
        SELECT report_id FROM reports
        WHERE user_id = ${owner.userId} AND derived_from IS NULL
        ORDER BY created_at ASC LIMIT ${allowance}
    `) as Array<{ report_id: string }>;

    return isFreeReport(reportId, rows.map((row) => row.report_id), allowance);
}

/**
 * Gives a signed-in person the reports their browser ran before they signed in.
 *
 * Only reports nobody has claimed: a report that already belongs to an account is
 * never moved, whatever visitor id arrives. Idempotent and cheap once done, since
 * the second call matches no rows.
 */
async function adoptVisitorReports(userId: string, visitorId: string): Promise<void> {
    const sql = client();
    if (sql === null) return;
    await sql`UPDATE reports SET user_id = ${userId} WHERE visitor_id = ${visitorId} AND user_id IS NULL`;
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

export interface CardUnlock {
    reportId: string;
    owner: ReportOwner;
    paymentId: string;
    amountMinor: number;
    currency: string;
}

/**
 * Records a report paid for by card. Returns false when no database is configured.
 *
 * Reached by two independent paths, the signed webhook and the lookup when a
 * customer returns from checkout, and often both for the same payment. Both
 * conflicts are therefore expected and harmless: the report already unlocked
 * (by this payment, an earlier one, or MON), or this payment already recorded.
 */
export async function recordCardUnlock(unlock: CardUnlock): Promise<boolean> {
    const sql = client();
    if (sql === null) return false;
    await ensureSchema();

    await sql`
        INSERT INTO report_unlocks (report_id, user_id, visitor_id, provider, payment_id, amount_minor, currency)
        VALUES (
            ${unlock.reportId}, ${unlock.owner.userId}, ${unlock.owner.visitorId},
            'dodo', ${unlock.paymentId}, ${unlock.amountMinor}, ${unlock.currency}
        )
        ON CONFLICT DO NOTHING
    `;
    return true;
}

/**
 * Takes back the report a card payment unlocked, after a full refund or a lost
 * dispute. Returns the report id it relocked, or null when that payment unlocked
 * nothing, which is normal when the report was already free for its owner.
 */
export async function revokeCardUnlock(paymentId: string): Promise<string | null> {
    const sql = client();
    if (sql === null) return null;
    await ensureSchema();

    const rows = (await sql`
        DELETE FROM report_unlocks WHERE payment_id = ${paymentId} RETURNING report_id
    `) as Array<{ report_id: string }>;
    return rows[0]?.report_id ?? null;
}

/**
 * Claims a webhook delivery for processing. True the first time an id is seen.
 *
 * Dodo retries a delivery until it gets a 2xx, and may deliver one event more
 * than once, so every handler runs behind this. With no database there is
 * nothing to remember against, and processing again is safe because every
 * write here is idempotent anyway.
 */
export async function claimWebhook(webhookId: string, eventType: string): Promise<boolean> {
    const sql = client();
    if (sql === null) return true;
    await ensureSchema();

    const rows = (await sql`
        INSERT INTO processed_webhooks (webhook_id, event_type)
        VALUES (${webhookId}, ${eventType})
        ON CONFLICT (webhook_id) DO NOTHING
        RETURNING webhook_id
    `) as unknown[];
    return rows.length > 0;
}

/** Lets a delivery be retried after its handler failed part way. */
export async function releaseWebhook(webhookId: string): Promise<void> {
    const sql = client();
    if (sql === null) return;
    await sql`DELETE FROM processed_webhooks WHERE webhook_id = ${webhookId}`;
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

// ============= OPTIMIZATIONS =============

/** Free optimizations this account has used. Zero without a database, which means no paywall either. */
export async function freeOptimizationsUsed(userId: string): Promise<number> {
    const sql = client();
    if (sql === null) return 0;
    await ensureSchema();
    const rows = (await sql`
        SELECT COUNT(*)::int AS used FROM optimizations WHERE user_id = ${userId} AND free
    `) as Array<{ used: number }>;
    return rows[0]?.used ?? 0;
}

/**
 * Whether someone paid for this report, by card or MON.
 *
 * Unlocks granted by an optimization do not count: they are the product of a
 * free optimization, and letting them unlock further optimizations would make
 * the free allowance unlimited.
 */
export async function reportWasPaidFor(reportId: string): Promise<boolean> {
    const sql = client();
    if (sql === null) return false;
    await ensureSchema();
    const rows = (await sql`
        SELECT 1 FROM report_unlocks
        WHERE report_id = ${reportId} AND provider IS DISTINCT FROM 'optimization'
    `) as unknown[];
    return rows.length > 0;
}

export interface OptimizationRecord {
    reportId: string;
    optimizedReport: RepoReport;
    owner: ReportOwner;
    free: boolean;
    beforeScore: number | null;
    afterScore: number | null;
}

/**
 * Stores the optimized contract's report and the optimization itself.
 *
 * The new report is saved already unlocked: the owner paid for it, in money or
 * in one of their free optimizations, and a result they cannot read is not a
 * result.
 */
export async function recordOptimization(record: OptimizationRecord): Promise<void> {
    const sql = client();
    if (sql === null) return;
    await ensureSchema();

    await saveReport(record.optimizedReport, record.owner, record.reportId);
    await sql`
        INSERT INTO report_unlocks (report_id, user_id, visitor_id, provider)
        VALUES (${record.optimizedReport.reportId}, ${record.owner.userId}, ${record.owner.visitorId}, 'optimization')
        ON CONFLICT (report_id) DO NOTHING
    `;
    await sql`
        INSERT INTO optimizations
            (optimization_id, report_id, optimized_report_id, user_id, visitor_id, free, before_score, after_score)
        VALUES (
            ${crypto.randomUUID()},
            ${record.reportId},
            ${record.optimizedReport.reportId},
            ${record.owner.userId},
            ${record.owner.visitorId},
            ${record.free},
            ${record.beforeScore},
            ${record.afterScore}
        )
    `;
}
