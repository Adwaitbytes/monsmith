import "server-only";

import { neon } from "@neondatabase/serverless";

/**
 * A ceiling on what one caller can spend of ours.
 *
 * Every expensive route here is open by design: no account, no key, paste a
 * contract and get an answer. That is the product, and it is why the endpoints
 * were written without a gate. The part that was missing is that a full report
 * runs for up to five minutes and makes a dozen model calls, so a loop of
 * `curl` against it spends real money per iteration, indefinitely, with nothing
 * in the way. Anonymous access was the decision; unmetered anonymous access was
 * an oversight.
 *
 * Fixed windows rather than a token bucket. A bucket is smoother and needs
 * either state per caller in memory — which serverless does not reliably keep —
 * or several round trips. A window is one statement, and the thing being
 * defended against is a script in a loop, which a window stops just as dead.
 *
 * Keyed on address, not on anything the caller states about itself. The visitor
 * id the studio sends is a header, and a header is a thing an attacker edits, so
 * a limiter trusting it can be defeated with a UUID generator. A signed-in user
 * gets their own key and a higher ceiling, because there is an account behind
 * them that can be dealt with if they abuse it.
 *
 * Fails open. When the database is unreachable or unconfigured, this allows the
 * request rather than refusing it: the studio is built to work with no
 * DATABASE_URL at all, and an outage in the meter must not take the product down
 * with it. An in-process counter still applies in that case, which on a warm
 * instance catches the obvious loop anyway.
 */

export interface RateLimitResult {
    ok: boolean;
    /** Requests left in this window. */
    remaining: number;
    /** Seconds until the window resets, for `Retry-After`. */
    retryAfter: number;
    limit: number;
}

export interface RateLimitRule {
    /** Namespace, so two routes with the same caller do not share a budget. */
    name: string;
    /** Requests allowed per window for an anonymous caller. */
    anonymous: number;
    /** Requests allowed per window for a signed-in one. */
    signedIn: number;
    windowSeconds: number;
}

/**
 * What each route costs us, and therefore what it is allowed.
 *
 * The numbers come from what the route spends, not from a general sense of
 * caution. A report is minutes of compute and a dozen model calls; a compile is
 * a second of CPU. Set them where an honest session never notices and a script
 * stops within a minute.
 */
export const LIMITS = {
    /** Minutes of compute and many model calls. The expensive one. */
    report: { name: "report", anonymous: 6, signedIn: 30, windowSeconds: 3600 },
    /** Model calls, up to five minutes. */
    optimize: { name: "optimize", anonymous: 12, signedIn: 60, windowSeconds: 3600 },
    /** Chat: cheap per turn, but a turn is a model call. */
    assistant: { name: "assistant", anonymous: 40, signedIn: 200, windowSeconds: 3600 },
    /** Generation and audit through the agent. */
    agent: { name: "agent", anonymous: 20, signedIn: 100, windowSeconds: 3600 },
    /** A card checkout session: cheap for us, but each one is a call to Dodo. */
    checkout: { name: "checkout", anonymous: 20, signedIn: 60, windowSeconds: 3600 },
    /** Real compute, no model: an EVM run, a compile, a fetch. */
    compute: { name: "compute", anonymous: 90, signedIn: 300, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>;

// ============= CALLER IDENTITY =============

/**
 * The address this request came from.
 *
 * `x-forwarded-for` is a list, appended to by each hop, and the platform's entry
 * is the last one it wrote — but on Vercel the leftmost is the client and the
 * chain is trusted, so that is the one to take. Locally there is no header at
 * all, which is why this can return null and the caller has to cope.
 */
function addressOf(req: Request): string | null {
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded !== null) {
        const first = forwarded.split(",")[0]?.trim();
        if (first !== undefined && first.length > 0) return first.slice(0, 64);
    }
    const real = req.headers.get("x-real-ip");
    if (real !== null && real.trim().length > 0) return real.trim().slice(0, 64);
    return null;
}

// ============= IN-PROCESS FALLBACK =============

/*
  A counter in memory, for when there is no database.

  Serverless instances come and go, so this is not a limit anybody should rely
  on — an attacker who lands on a cold instance starts from zero. It is here
  because a warm instance handles a burst from one script, and catching that for
  free is better than catching nothing while the meter is down.
*/
const local = new Map<string, { count: number; expires: number }>();

function localHit(key: string, max: number, windowSeconds: number): RateLimitResult {
    const now = Date.now();
    const found = local.get(key);

    if (found === undefined || found.expires <= now) {
        local.set(key, { count: 1, expires: now + windowSeconds * 1000 });
        // Unbounded growth would be a leak in a long-lived instance, and the
        // expired entries are the ones nobody will ask for again.
        if (local.size > 10_000) {
            for (const [entry, value] of local) {
                if (value.expires <= now) local.delete(entry);
            }
        }
        return { ok: true, remaining: max - 1, retryAfter: 0, limit: max };
    }

    found.count += 1;
    const retryAfter = Math.max(1, Math.ceil((found.expires - now) / 1000));
    return {
        ok: found.count <= max,
        remaining: Math.max(0, max - found.count),
        retryAfter,
        limit: max,
    };
}

// ============= DURABLE COUNTER =============

function client() {
    const url = process.env.DATABASE_URL;
    if (url === undefined || url.length === 0) return null;
    return neon(url);
}

let provisioned = false;

type Sql = NonNullable<ReturnType<typeof client>>;

async function ensureSchema(sql: Sql): Promise<void> {
    if (provisioned) return;
    await sql`
        CREATE TABLE IF NOT EXISTS rate_limits (
            key          TEXT PRIMARY KEY,
            count        INTEGER     NOT NULL,
            window_start TIMESTAMPTZ NOT NULL
        )
    `;
    provisioned = true;
}

/**
 * Counts one request against a key, atomically.
 *
 * Read-then-write would let two concurrent requests both read the same count
 * and both decide they were under the limit, which is exactly the shape of
 * traffic a limiter exists for. A single upsert that rolls the window over in
 * its own `CASE` leaves no gap between the read and the write.
 */
async function durableHit(
    key: string,
    max: number,
    windowSeconds: number,
): Promise<RateLimitResult | null> {
    const sql = client();
    if (sql === null) return null;

    try {
        await ensureSchema(sql);

        const rows = (await sql`
            INSERT INTO rate_limits (key, count, window_start)
            VALUES (${key}, 1, NOW())
            ON CONFLICT (key) DO UPDATE SET
                count = CASE
                    WHEN rate_limits.window_start < NOW() - MAKE_INTERVAL(secs => ${windowSeconds})
                    THEN 1
                    ELSE rate_limits.count + 1
                END,
                window_start = CASE
                    WHEN rate_limits.window_start < NOW() - MAKE_INTERVAL(secs => ${windowSeconds})
                    THEN NOW()
                    ELSE rate_limits.window_start
                END
            RETURNING count, EXTRACT(EPOCH FROM (NOW() - window_start))::int AS age
        `) as Array<{ count: number; age: number }>;

        const row = rows[0];
        if (row === undefined) return null;

        const retryAfter = Math.max(1, windowSeconds - row.age);
        return {
            ok: row.count <= max,
            remaining: Math.max(0, max - row.count),
            retryAfter,
            limit: max,
        };
    } catch (error) {
        // Loudly, because a silently broken limiter is the same as none, and
        // the product keeps serving either way.
        const detail = error instanceof Error ? error.message : "unknown error";
        console.error(`[rate-limit] durable counter unavailable: ${detail}`);
        return null;
    }
}

// ============= ENTRY POINT =============

/**
 * Counts this request and says whether to serve it.
 *
 * `userId` raises the ceiling when there is an account behind the caller. It
 * comes from the session on the server, never from the request body, or it
 * would be the ceiling anybody could claim.
 */
export async function rateLimit(
    req: Request,
    rule: RateLimitRule,
    userId: string | null = null,
): Promise<RateLimitResult> {
    const max = userId !== null ? rule.signedIn : rule.anonymous;
    const who = userId !== null ? `u:${userId}` : `a:${addressOf(req) ?? "unknown"}`;
    const key = `${rule.name}:${who}`;

    // The in-process count runs either way: it costs nothing and it is the only
    // thing standing there when the database is not.
    const memory = localHit(key, max, rule.windowSeconds);

    const durable = await durableHit(key, max, rule.windowSeconds);
    if (durable === null) return memory;

    // Whichever says stop, stops. They disagree only when an instance has been
    // warm for part of a window, and the stricter answer is the safe one.
    if (!memory.ok) return memory;
    return durable;
}

/** The 429 to send when a limit is reached, with the header a client needs. */
export function tooManyRequests(result: RateLimitResult, what: string): Response {
    const minutes = Math.ceil(result.retryAfter / 60);
    const wait = minutes <= 1 ? "a minute" : `${minutes} minutes`;

    return new Response(
        JSON.stringify({
            success: false,
            error: `That is ${result.limit} ${what} in an hour, which is as many as this runs for one visitor. Try again in ${wait}, or sign in for a higher limit.`,
            failure: "rate-limited",
            retryAfter: result.retryAfter,
        }),
        {
            status: 429,
            headers: {
                "Content-Type": "application/json",
                "Retry-After": String(result.retryAfter),
                "Cache-Control": "no-store",
            },
        },
    );
}
