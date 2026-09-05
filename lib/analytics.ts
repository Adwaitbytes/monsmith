import { neon } from "@neondatabase/serverless";

/**
 * Server-side analytics against Neon Postgres.
 *
 * This lives on the server because a Postgres connection string is a secret; the
 * previous implementation ran in the browser against a Supabase project that had
 * since been deleted, and every write failed into a swallowed catch for weeks
 * without anyone noticing. Failures here are logged loudly for that reason.
 */

export type EventType =
  | "page_view"
  | "compile"
  | "deploy"
  | "audit"
  | "parallel_analysis"
  | "gas_profile"
  | "chain_fit"
  | "migration"
  | "ai_generate"
  | "transpile"
  | "interact_read"
  | "interact_write"
  | "wallet_connect";

export type EventStatus = "success" | "error";

export interface TrackedEvent {
  visitorId: string;
  type: EventType;
  status?: EventStatus;
  durationMs?: number;
  detail?: Record<string, unknown>;
  walletAddress?: string;
  /** Where and how the request arrived, derived server-side. */
  context?: {
    country?: string | null;
    city?: string | null;
    region?: string | null;
    browser?: string | null;
    os?: string | null;
    device?: string | null;
  };
  referrer?: string | null;
  path?: string | null;
}

export interface DeploymentRecord {
  visitorId: string;
  contractAddress: string;
  contractName?: string;
  txHash: string;
  deployerAddress: string;
  gasUsed?: string;
  chainId?: number;
}

/** Null when DATABASE_URL is absent, so local development runs without a database. */
function client() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return neon(url);
}

export function analyticsConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** Upserts the visitor, so first_seen survives and last_seen advances. */
async function touchVisitor(
  visitorId: string,
  walletAddress?: string,
  country?: string | null,
  city?: string | null,
  referrer?: string | null
): Promise<void> {
  const sql = client();
  if (!sql) return;

  await sql`
    INSERT INTO users (visitor_id, wallet_address, country, city, first_referrer)
    VALUES (${visitorId}, ${walletAddress ?? null}, ${country ?? null}, ${city ?? null}, ${referrer ?? null})
    ON CONFLICT (visitor_id) DO UPDATE
      SET last_seen_at  = NOW(),
          session_count = users.session_count + 1,
          -- Never overwrite known values with null: a later event without
          -- context would otherwise erase what an earlier one established.
          wallet_address = COALESCE(EXCLUDED.wallet_address, users.wallet_address),
          country        = COALESCE(users.country, EXCLUDED.country),
          city           = COALESCE(users.city, EXCLUDED.city),
          first_referrer = COALESCE(users.first_referrer, EXCLUDED.first_referrer)
  `;
}

export async function trackEvent(event: TrackedEvent): Promise<boolean> {
  const sql = client();
  if (!sql) return false;

  try {
    const ctx = event.context ?? {};
    await touchVisitor(event.visitorId, event.walletAddress, ctx.country, ctx.city, event.referrer);
    await sql`
      INSERT INTO events (
        visitor_id, event_type, status, duration_ms, detail,
        country, city, region, browser, os, device, referrer, path
      )
      VALUES (
        ${event.visitorId},
        ${event.type},
        ${event.status ?? "success"},
        ${event.durationMs ?? null},
        ${JSON.stringify(event.detail ?? {})},
        ${ctx.country ?? null}, ${ctx.city ?? null}, ${ctx.region ?? null},
        ${ctx.browser ?? null}, ${ctx.os ?? null}, ${ctx.device ?? null},
        ${event.referrer ?? null}, ${event.path ?? null}
      )
    `;
    return true;
  } catch (error) {
    // Analytics must never break the feature it measures, but a silent failure
    // is what made the previous system useless, so this is always reported.
    console.error("Analytics write failed:", error instanceof Error ? error.message : error);
    return false;
  }
}

export async function recordDeployment(record: DeploymentRecord): Promise<boolean> {
  const sql = client();
  if (!sql) return false;

  try {
    await touchVisitor(record.visitorId, record.deployerAddress);
    await sql`
      INSERT INTO deployments (
        visitor_id, contract_address, contract_name, tx_hash,
        deployer_address, chain_id, gas_used
      )
      VALUES (
        ${record.visitorId}, ${record.contractAddress}, ${record.contractName ?? null},
        ${record.txHash}, ${record.deployerAddress}, ${record.chainId ?? 10143},
        ${record.gasUsed ?? null}
      )
      ON CONFLICT (tx_hash) DO NOTHING
    `;
    return true;
  } catch (error) {
    console.error("Deployment write failed:", error instanceof Error ? error.message : error);
    return false;
  }
}

export interface StatsSummary {
  totalUsers: number;
  walletUsers: number;
  activeLast7Days: number;
  activeLast24Hours: number;
  totalEvents: number;
  totalDeployments: number;
  eventBreakdown: { type: string; count: number; errors: number }[];
  dailyActive: { day: string; users: number; events: number }[];
  recentDeployments: {
    contractName: string | null;
    contractAddress: string;
    txHash: string;
    createdAt: string;
  }[];
  firstEventAt: string | null;

  countries: { country: string | null; users: number; events: number }[];
  cities: { city: string | null; country: string | null; users: number }[];
  browsers: { name: string | null; users: number }[];
  operatingSystems: { name: string | null; users: number }[];
  devices: { name: string | null; users: number }[];
  referrers: { source: string | null; users: number }[];
  hourly: { hour: number; events: number }[];
  /** Visitors who came back on a later day. */
  returningUsers: number;
  /** How far people get: visited -> compiled -> deployed. */
  funnel: { stage: string; users: number }[];
  slowest: { type: string; avgMs: number; maxMs: number }[];
  liveFeed: {
    type: string;
    status: string;
    country: string | null;
    city: string | null;
    createdAt: string;
    detail: Record<string, unknown>;
  }[];
}

/**
 * Everything needed to answer "how many people use this and what do they do"
 * in one round trip, so the dashboard is a single query rather than a dozen.
 */
export async function getStats(): Promise<StatsSummary | null> {
  const sql = client();
  if (!sql) return null;

  const [totals] = await sql`
    SELECT
      (SELECT COUNT(*) FROM users)                                              AS total_users,
      (SELECT COUNT(*) FROM users WHERE wallet_address IS NOT NULL)             AS wallet_users,
      (SELECT COUNT(*) FROM users WHERE last_seen_at > NOW() - INTERVAL '7 days')  AS active_7d,
      (SELECT COUNT(*) FROM users WHERE last_seen_at > NOW() - INTERVAL '1 day')   AS active_24h,
      (SELECT COUNT(*) FROM events)                                             AS total_events,
      (SELECT COUNT(*) FROM deployments)                                        AS total_deployments,
      (SELECT MIN(created_at) FROM events)                                      AS first_event_at
  `;

  const breakdown = await sql`
    SELECT event_type,
           COUNT(*)                                   AS count,
           COUNT(*) FILTER (WHERE status = 'error')   AS errors
    FROM events
    GROUP BY event_type
    ORDER BY count DESC
  `;

  const daily = await sql`
    SELECT TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS day,
           COUNT(DISTINCT visitor_id)                           AS users,
           COUNT(*)                                             AS events
    FROM events
    WHERE created_at > NOW() - INTERVAL '30 days'
    GROUP BY 1
    ORDER BY 1 DESC
  `;

  const recent = await sql`
    SELECT contract_name, contract_address, tx_hash, created_at
    FROM deployments
    ORDER BY created_at DESC
    LIMIT 10
  `;

  const countries = await sql`
    SELECT country, COUNT(DISTINCT visitor_id) AS users, COUNT(*) AS events
    FROM events GROUP BY country ORDER BY users DESC, events DESC LIMIT 25
  `;

  const cities = await sql`
    SELECT city, country, COUNT(DISTINCT visitor_id) AS users
    FROM events WHERE city IS NOT NULL
    GROUP BY city, country ORDER BY users DESC LIMIT 25
  `;

  const browsers = await sql`
    SELECT browser AS name, COUNT(DISTINCT visitor_id) AS users
    FROM events GROUP BY browser ORDER BY users DESC
  `;

  const operatingSystems = await sql`
    SELECT os AS name, COUNT(DISTINCT visitor_id) AS users
    FROM events GROUP BY os ORDER BY users DESC
  `;

  const devices = await sql`
    SELECT device AS name, COUNT(DISTINCT visitor_id) AS users
    FROM events GROUP BY device ORDER BY users DESC
  `;

  const referrers = await sql`
    SELECT COALESCE(first_referrer, 'direct') AS source, COUNT(*) AS users
    FROM users GROUP BY 1 ORDER BY users DESC LIMIT 15
  `;

  const hourly = await sql`
    SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*) AS events
    FROM events GROUP BY 1 ORDER BY 1
  `;

  // A visitor counts as returning once they appear on more than one calendar day.
  const [returning] = await sql`
    SELECT COUNT(*) AS returning_users FROM (
      SELECT visitor_id FROM events
      GROUP BY visitor_id HAVING COUNT(DISTINCT DATE_TRUNC('day', created_at)) > 1
    ) repeat_visitors
  `;

  const [funnelRow] = await sql`
    SELECT
      (SELECT COUNT(DISTINCT visitor_id) FROM events)                                  AS visited,
      (SELECT COUNT(DISTINCT visitor_id) FROM events WHERE event_type = 'compile')     AS compiled,
      (SELECT COUNT(DISTINCT visitor_id) FROM events WHERE event_type = 'deploy')      AS deployed,
      (SELECT COUNT(DISTINCT visitor_id) FROM events WHERE event_type = 'wallet_connect') AS connected
  `;

  const slowest = await sql`
    SELECT event_type AS type,
           ROUND(AVG(duration_ms))::int AS avg_ms,
           MAX(duration_ms)::int        AS max_ms
    FROM events WHERE duration_ms IS NOT NULL
    GROUP BY event_type ORDER BY avg_ms DESC LIMIT 10
  `;

  const liveFeed = await sql`
    SELECT event_type, status, country, city, created_at, detail
    FROM events ORDER BY created_at DESC LIMIT 40
  `;

  return {
    countries: countries.map((r) => ({
      country: r.country ? String(r.country) : null,
      users: Number(r.users),
      events: Number(r.events),
    })),
    cities: cities.map((r) => ({
      city: r.city ? String(r.city) : null,
      country: r.country ? String(r.country) : null,
      users: Number(r.users),
    })),
    browsers: browsers.map((r) => ({ name: r.name ? String(r.name) : null, users: Number(r.users) })),
    operatingSystems: operatingSystems.map((r) => ({ name: r.name ? String(r.name) : null, users: Number(r.users) })),
    devices: devices.map((r) => ({ name: r.name ? String(r.name) : null, users: Number(r.users) })),
    referrers: referrers.map((r) => ({ source: r.source ? String(r.source) : null, users: Number(r.users) })),
    hourly: hourly.map((r) => ({ hour: Number(r.hour), events: Number(r.events) })),
    returningUsers: Number(returning.returning_users),
    funnel: [
      { stage: "Visited", users: Number(funnelRow.visited) },
      { stage: "Connected wallet", users: Number(funnelRow.connected) },
      { stage: "Compiled", users: Number(funnelRow.compiled) },
      { stage: "Deployed", users: Number(funnelRow.deployed) },
    ],
    slowest: slowest.map((r) => ({
      type: String(r.type),
      avgMs: Number(r.avg_ms),
      maxMs: Number(r.max_ms),
    })),
    liveFeed: liveFeed.map((r) => ({
      type: String(r.event_type),
      status: String(r.status),
      country: r.country ? String(r.country) : null,
      city: r.city ? String(r.city) : null,
      createdAt: new Date(r.created_at).toISOString(),
      detail: (r.detail ?? {}) as Record<string, unknown>,
    })),
    totalUsers: Number(totals.total_users),
    walletUsers: Number(totals.wallet_users),
    activeLast7Days: Number(totals.active_7d),
    activeLast24Hours: Number(totals.active_24h),
    totalEvents: Number(totals.total_events),
    totalDeployments: Number(totals.total_deployments),
    firstEventAt: totals.first_event_at ? new Date(totals.first_event_at).toISOString() : null,
    eventBreakdown: breakdown.map((row) => ({
      type: String(row.event_type),
      count: Number(row.count),
      errors: Number(row.errors),
    })),
    dailyActive: daily.map((row) => ({
      day: String(row.day),
      users: Number(row.users),
      events: Number(row.events),
    })),
    recentDeployments: recent.map((row) => ({
      contractName: row.contract_name ? String(row.contract_name) : null,
      contractAddress: String(row.contract_address),
      txHash: String(row.tx_hash),
      createdAt: new Date(row.created_at).toISOString(),
    })),
  };
}
