import 'server-only';

import { neon } from '@neondatabase/serverless';

import type { TrackedFinding } from './tracking';

/**
 * What the pull request review remembers.
 *
 * Three things, each for a reason. Installations, because "how many teams still
 * have it running in week four" is the number that says whether this is a
 * product or a demo, and that needs the install date and the uninstall date
 * kept rather than the row deleted. Pull requests, so the comment can be edited
 * instead of reposted and a slow review of an old push cannot overwrite a newer
 * one. And reviews, one per push, holding the findings in the shape the next
 * push is compared against, which is how a fix gets counted.
 *
 * Provisioned on first use like every other table in this codebase.
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
        CREATE TABLE IF NOT EXISTS pr_installations (
            installation_id BIGINT      PRIMARY KEY,
            account_login   TEXT,
            account_type    TEXT,
            installed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            uninstalled_at  TIMESTAMPTZ,
            suspended_at    TIMESTAMPTZ
        )
    `;
    await sql`
        CREATE TABLE IF NOT EXISTS pull_requests (
            repo_id         BIGINT      NOT NULL,
            number          INTEGER     NOT NULL,
            installation_id BIGINT      NOT NULL,
            repo_full_name  TEXT        NOT NULL,
            private         BOOLEAN     NOT NULL,
            title           TEXT,
            author          TEXT,
            latest_head     TEXT        NOT NULL,
            comment_id      BIGINT,
            opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            merged_at       TIMESTAMPTZ,
            closed_at       TIMESTAMPTZ,
            merge_sha       TEXT,
            PRIMARY KEY (repo_id, number)
        )
    `;
    await sql`
        CREATE TABLE IF NOT EXISTS pr_reviews (
            review_id       TEXT        PRIMARY KEY,
            repo_id         BIGINT      NOT NULL,
            number          INTEGER     NOT NULL,
            installation_id BIGINT      NOT NULL,
            head_sha        TEXT        NOT NULL,
            report_id       TEXT        NOT NULL,
            score           INTEGER,
            scores          JSONB       NOT NULL,
            findings        JSONB       NOT NULL,
            fixed           JSONB       NOT NULL,
            introduced      JSONB       NOT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS pr_reviews_pull ON pr_reviews (repo_id, number, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS pr_reviews_installation ON pr_reviews (installation_id, created_at DESC)`;
    await sql`
        CREATE TABLE IF NOT EXISTS pr_attestations (
            repo_id         BIGINT      NOT NULL,
            number          INTEGER     NOT NULL,
            installation_id BIGINT      NOT NULL,
            contract_path   TEXT        NOT NULL,
            source_hash     TEXT        NOT NULL,
            tx_hash         TEXT        NOT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (repo_id, number, contract_path)
        )
    `;
    provisioned = true;
}

// ============= INSTALLATIONS =============

export async function recordInstall(installationId: number, account: string | null, accountType: string | null): Promise<void> {
    const sql = client();
    if (sql === null) return;
    await ensureSchema();
    await sql`
        INSERT INTO pr_installations (installation_id, account_login, account_type)
        VALUES (${installationId}, ${account}, ${accountType})
        ON CONFLICT (installation_id) DO UPDATE
            SET account_login  = COALESCE(EXCLUDED.account_login, pr_installations.account_login),
                account_type   = COALESCE(EXCLUDED.account_type, pr_installations.account_type),
                uninstalled_at = NULL
    `;
}

export async function recordUninstall(installationId: number): Promise<void> {
    const sql = client();
    if (sql === null) return;
    await ensureSchema();
    await sql`UPDATE pr_installations SET uninstalled_at = NOW() WHERE installation_id = ${installationId}`;
}

export async function recordSuspension(installationId: number, suspended: boolean): Promise<void> {
    const sql = client();
    if (sql === null) return;
    await ensureSchema();
    await sql`
        UPDATE pr_installations SET suspended_at = ${suspended ? new Date().toISOString() : null}
        WHERE installation_id = ${installationId}
    `;
}

// ============= PULL REQUESTS =============

export interface PullRecord {
    repoId: number;
    number: number;
    installationId: number;
    repoFullName: string;
    private: boolean;
    title: string;
    author: string | null;
    headSha: string;
}

/**
 * Notes the newest head GitHub told us about, before the review starts.
 *
 * Reviews take a minute or two and pushes can land closer together than that.
 * Whichever review finishes, only the one for the newest head may touch the
 * comment, and this row is what it checks against. An installation seen for
 * the first time through a pull request is recorded too, since an install
 * that predates the webhook never sent its own event.
 */
export async function notePullHead(pull: PullRecord): Promise<{ commentId: number | null }> {
    const sql = client();
    if (sql === null) return { commentId: null };
    await ensureSchema();
    await sql`
        INSERT INTO pr_installations (installation_id) VALUES (${pull.installationId})
        ON CONFLICT (installation_id) DO NOTHING
    `;
    const rows = (await sql`
        INSERT INTO pull_requests (repo_id, number, installation_id, repo_full_name, private, title, author, latest_head)
        VALUES (${pull.repoId}, ${pull.number}, ${pull.installationId}, ${pull.repoFullName}, ${pull.private}, ${pull.title}, ${pull.author}, ${pull.headSha})
        ON CONFLICT (repo_id, number) DO UPDATE
            SET latest_head    = EXCLUDED.latest_head,
                title          = EXCLUDED.title,
                repo_full_name = EXCLUDED.repo_full_name,
                private        = EXCLUDED.private,
                closed_at      = NULL
        RETURNING comment_id
    `) as Array<{ comment_id: string | number | null }>;
    const id = rows[0]?.comment_id;
    return { commentId: id === null || id === undefined ? null : Number(id) };
}

export async function latestHead(repoId: number, number: number): Promise<string | null> {
    const sql = client();
    if (sql === null) return null;
    await ensureSchema();
    const rows = (await sql`SELECT latest_head FROM pull_requests WHERE repo_id = ${repoId} AND number = ${number}`) as Array<{ latest_head: string }>;
    return rows[0]?.latest_head ?? null;
}

export async function saveCommentId(repoId: number, number: number, commentId: number): Promise<void> {
    const sql = client();
    if (sql === null) return;
    await ensureSchema();
    await sql`UPDATE pull_requests SET comment_id = ${commentId} WHERE repo_id = ${repoId} AND number = ${number}`;
}

export async function commentIdFor(repoId: number, number: number): Promise<number | null> {
    const sql = client();
    if (sql === null) return null;
    await ensureSchema();
    const rows = (await sql`SELECT comment_id FROM pull_requests WHERE repo_id = ${repoId} AND number = ${number}`) as Array<{ comment_id: string | number | null }>;
    const id = rows[0]?.comment_id;
    return id === null || id === undefined ? null : Number(id);
}

export async function markClosed(repoId: number, number: number, merged: boolean, mergeSha: string | null): Promise<void> {
    const sql = client();
    if (sql === null) return;
    await ensureSchema();
    await sql`
        UPDATE pull_requests
        SET closed_at = NOW(),
            merged_at = ${merged ? new Date().toISOString() : null},
            merge_sha = ${mergeSha}
        WHERE repo_id = ${repoId} AND number = ${number}
    `;
}

// ============= REVIEWS =============

export interface StoredReview {
    reviewId: string;
    headSha: string;
    reportId: string;
    scores: Record<string, number>;
    findings: TrackedFinding[];
    fixed: TrackedFinding[];
    introduced: TrackedFinding[];
    createdAt: string;
}

interface ReviewRow {
    review_id: string;
    head_sha: string;
    report_id: string;
    scores: Record<string, number>;
    findings: TrackedFinding[];
    fixed: TrackedFinding[];
    introduced: TrackedFinding[];
    created_at: string;
}

function shapeReview(row: ReviewRow): StoredReview {
    return {
        reviewId: row.review_id,
        headSha: row.head_sha,
        reportId: row.report_id,
        scores: row.scores,
        findings: row.findings,
        fixed: row.fixed,
        introduced: row.introduced,
        createdAt: new Date(row.created_at).toISOString(),
    };
}

/** Every review of a pull request, oldest first. */
export async function reviewsOf(repoId: number, number: number): Promise<StoredReview[]> {
    const sql = client();
    if (sql === null) return [];
    await ensureSchema();
    const rows = (await sql`
        SELECT review_id, head_sha, report_id, scores, findings, fixed, introduced, created_at
        FROM pr_reviews WHERE repo_id = ${repoId} AND number = ${number}
        ORDER BY created_at ASC
    `) as ReviewRow[];
    return rows.map(shapeReview);
}

export interface NewReview {
    repoId: number;
    number: number;
    installationId: number;
    headSha: string;
    reportId: string;
    score: number | null;
    scores: Record<string, number>;
    findings: TrackedFinding[];
    fixed: TrackedFinding[];
    introduced: TrackedFinding[];
}

export async function saveReview(review: NewReview): Promise<void> {
    const sql = client();
    if (sql === null) return;
    await ensureSchema();
    await sql`
        INSERT INTO pr_reviews (review_id, repo_id, number, installation_id, head_sha, report_id, score, scores, findings, fixed, introduced)
        VALUES (
            ${crypto.randomUUID()}, ${review.repoId}, ${review.number}, ${review.installationId}, ${review.headSha},
            ${review.reportId}, ${review.score}, ${JSON.stringify(review.scores)}, ${JSON.stringify(review.findings)},
            ${JSON.stringify(review.fixed)}, ${JSON.stringify(review.introduced)}
        )
    `;
}

/** Reviews this installation ran in the last thirty days, which is what the free allowance meters. */
export async function reviewsThisMonth(installationId: number): Promise<number> {
    const sql = client();
    if (sql === null) return 0;
    await ensureSchema();
    const rows = (await sql`
        SELECT COUNT(*)::int AS n FROM pr_reviews
        WHERE installation_id = ${installationId} AND created_at > NOW() - INTERVAL '30 days'
    `) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
}

// ============= ATTESTATIONS =============

export async function attestationsThisMonth(installationId: number): Promise<number> {
    const sql = client();
    if (sql === null) return 0;
    await ensureSchema();
    const rows = (await sql`
        SELECT COUNT(*)::int AS n FROM pr_attestations
        WHERE installation_id = ${installationId} AND created_at > NOW() - INTERVAL '30 days'
    `) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
}

export async function attestationsOfPull(repoId: number, number: number): Promise<Array<{ path: string; txHash: string }>> {
    const sql = client();
    if (sql === null) return [];
    await ensureSchema();
    const rows = (await sql`
        SELECT contract_path, tx_hash FROM pr_attestations WHERE repo_id = ${repoId} AND number = ${number}
    `) as Array<{ contract_path: string; tx_hash: string }>;
    return rows.map((row) => ({ path: row.contract_path, txHash: row.tx_hash }));
}

export async function recordPullAttestation(
    repoId: number,
    number: number,
    installationId: number,
    path: string,
    sourceHash: string,
    txHash: string,
): Promise<void> {
    const sql = client();
    if (sql === null) return;
    await ensureSchema();
    await sql`
        INSERT INTO pr_attestations (repo_id, number, installation_id, contract_path, source_hash, tx_hash)
        VALUES (${repoId}, ${number}, ${installationId}, ${path}, ${sourceHash}, ${txHash})
        ON CONFLICT (repo_id, number, contract_path) DO NOTHING
    `;
}

// ============= THE NUMBERS =============

export interface PullReviewStats {
    /** Installations live now, team accounts excluded. */
    activeInstalls: number;
    /** Installed at least 28 days ago, team accounts excluded. */
    installsFourWeeksOld: number;
    /** Of those, still installed and with a review in the last 14 days. */
    retainedAtWeekFour: number;
    pullsReviewed: number;
    reviews: number;
    /** Findings that a later push on the same pull request resolved. */
    findingsFixed: number;
    /** Of those, on pull requests that went on to merge. */
    fixesMerged: number;
    pullsMerged: number;
    attestations: number;
    /** Accounts left out of every number above, so the reader knows what was excluded. */
    excludedAccounts: string[];
}

/**
 * The validation numbers, with the team's own accounts left out.
 *
 * A demo repository the author installed on is the easiest way to make every
 * one of these look better than it is, so team logins are excluded by account
 * rather than by trusting someone to remember.
 */
export async function pullReviewStats(teamLogins: readonly string[]): Promise<PullReviewStats | null> {
    const sql = client();
    if (sql === null) return null;
    await ensureSchema();

    const team = teamLogins.map((login) => login.toLowerCase());
    const rows = (await sql`
        WITH outside AS (
            SELECT installation_id, installed_at, uninstalled_at FROM pr_installations
            WHERE account_login IS NULL OR NOT (LOWER(account_login) = ANY(${team}))
        ),
        reviews AS (
            SELECT r.* FROM pr_reviews r JOIN outside o USING (installation_id)
        ),
        pulls AS (
            SELECT p.* FROM pull_requests p JOIN outside o USING (installation_id)
        )
        SELECT
            (SELECT COUNT(*) FROM outside WHERE uninstalled_at IS NULL)::int AS active_installs,
            (SELECT COUNT(*) FROM outside WHERE installed_at < NOW() - INTERVAL '28 days')::int AS installs_four_weeks_old,
            (SELECT COUNT(*) FROM outside o
                WHERE o.installed_at < NOW() - INTERVAL '28 days' AND o.uninstalled_at IS NULL
                  AND EXISTS (SELECT 1 FROM reviews r WHERE r.installation_id = o.installation_id AND r.created_at > NOW() - INTERVAL '14 days'))::int AS retained,
            (SELECT COUNT(DISTINCT (repo_id, number)) FROM reviews)::int AS pulls_reviewed,
            (SELECT COUNT(*) FROM reviews)::int AS reviews,
            (SELECT COALESCE(SUM(jsonb_array_length(fixed)), 0) FROM reviews)::int AS findings_fixed,
            (SELECT COALESCE(SUM(jsonb_array_length(r.fixed)), 0) FROM reviews r
                JOIN pulls p ON p.repo_id = r.repo_id AND p.number = r.number WHERE p.merged_at IS NOT NULL)::int AS fixes_merged,
            (SELECT COUNT(*) FROM pulls WHERE merged_at IS NOT NULL)::int AS pulls_merged,
            (SELECT COUNT(*) FROM pr_attestations a JOIN outside o USING (installation_id))::int AS attestations
    `) as Array<Record<string, number>>;

    const row = rows[0];
    if (row === undefined) return null;
    return {
        activeInstalls: row.active_installs,
        installsFourWeeksOld: row.installs_four_weeks_old,
        retainedAtWeekFour: row.retained,
        pullsReviewed: row.pulls_reviewed,
        reviews: row.reviews,
        findingsFixed: row.findings_fixed,
        fixesMerged: row.fixes_merged,
        pullsMerged: row.pulls_merged,
        attestations: row.attestations,
        excludedAccounts: [...teamLogins],
    };
}
