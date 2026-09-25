/**
 * The ceiling on what one caller can spend of ours.
 *
 * Every expensive route here is open by design -- no account, paste a contract,
 * get an answer -- and that was fine until you notice a full report runs for
 * five minutes and makes a dozen model calls. A loop of `curl` against it spent
 * real money per iteration with nothing in the way.
 *
 * These cover the two properties that matter: it actually stops somebody at the
 * limit, and it never stops the product when its own storage is missing. The
 * second is not a nicety -- the studio is built to run with no DATABASE_URL at
 * all, and a meter that takes the site down when it cannot count is worse than
 * the abuse it prevents.
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { LIMITS, rateLimit, tooManyRequests } from "../lib/rateLimit.ts";

/** A request from one address, which is what the limiter keys on. */
function from(ip: string): Request {
    return new Request("https://monsmith.com/api/report", {
        method: "POST",
        headers: { "x-forwarded-for": ip },
    });
}

const RULE = { name: "test", anonymous: 3, signedIn: 6, windowSeconds: 3600 };

let seq = 0;
beforeEach(() => {
    // A fresh namespace per test: the in-process counter is module state and
    // would otherwise carry one test's spending into the next.
    seq += 1;
});

// Unique per run as well as per test. Without a DATABASE_URL the counter is
// process memory and a fixed name would do, but a CI box with one configured
// would inherit the previous run's totals and fail on the first assertion.
const RUN = Math.random().toString(36).slice(2, 10);

const rule = (over: Partial<typeof RULE> = {}) => ({ ...RULE, ...over, name: `test-${RUN}-${seq}` });

test("requests under the limit are served", async () => {
    const r = rule();
    for (let i = 0; i < 3; i++) {
        const result = await rateLimit(from("1.2.3.4"), r);
        assert.equal(result.ok, true, `request ${i + 1}`);
    }
});

test("the request past the limit is refused", async () => {
    const r = rule();
    for (let i = 0; i < 3; i++) await rateLimit(from("1.2.3.4"), r);

    const over = await rateLimit(from("1.2.3.4"), r);
    assert.equal(over.ok, false);
    assert.equal(over.remaining, 0);
    assert.ok(over.retryAfter > 0, "must say when to come back");
});

test("one caller's spending does not count against another's", async () => {
    const r = rule();
    for (let i = 0; i < 4; i++) await rateLimit(from("1.2.3.4"), r);

    // The point of keying on the caller. A shared budget would let one script
    // lock every other visitor out, which is a denial of service we built.
    const other = await rateLimit(from("5.6.7.8"), r);
    assert.equal(other.ok, true);
});

test("signing in raises the ceiling", async () => {
    const r = rule();
    for (let i = 0; i < 6; i++) {
        const result = await rateLimit(from("1.2.3.4"), r, "user_abc");
        assert.equal(result.ok, true, `request ${i + 1}`);
    }
    assert.equal((await rateLimit(from("1.2.3.4"), r, "user_abc")).ok, false);
});

test("an account is its own budget, not its address's", async () => {
    const r = rule();
    // Two people behind one office NAT must not share a limit, and the same
    // account from two machines must not get two.
    for (let i = 0; i < 3; i++) await rateLimit(from("9.9.9.9"), r);

    assert.equal((await rateLimit(from("9.9.9.9"), r)).ok, false, "anonymous is spent");
    assert.equal((await rateLimit(from("9.9.9.9"), r, "user_xyz")).ok, true, "the account is not");
});

test("a caller with no address still gets a budget rather than a free pass", async () => {
    const r = rule();
    const anonymous = new Request("https://monsmith.com/api/report", { method: "POST" });
    for (let i = 0; i < 3; i++) await rateLimit(anonymous, r);

    // Locally there is no forwarding header. Treating that as unlimited would
    // make the limiter trivially bypassable by stripping one header.
    assert.equal((await rateLimit(anonymous, r)).ok, false);
});

test("it counts without a database rather than refusing everything", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
        const r = rule();
        assert.equal((await rateLimit(from("4.4.4.4"), r)).ok, true);
        for (let i = 0; i < 3; i++) await rateLimit(from("4.4.4.4"), r);
        // Still counting, in process, with nowhere to write it down.
        assert.equal((await rateLimit(from("4.4.4.4"), r)).ok, false);
    } finally {
        if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
});

test("the refusal says what to do about it", async () => {
    const response = tooManyRequests(
        { ok: false, remaining: 0, retryAfter: 1800, limit: 6 },
        "full reports",
    );

    assert.equal(response.status, 429);
    // Without this a client has to guess, and guessing means retrying now.
    assert.equal(response.headers.get("Retry-After"), "1800");

    const body = (await response.json()) as { error: string; failure: string };
    assert.equal(body.failure, "rate-limited");
    assert.match(body.error, /30 minutes/);
    assert.match(body.error, /sign in/i);
});

test("the shipped limits are sized to what each route spends", () => {
    // A report is minutes of compute and many model calls; a compile is a
    // second of CPU. If these ever converge, one of them is mispriced.
    assert.ok(LIMITS.report.anonymous < LIMITS.compute.anonymous);
    assert.ok(LIMITS.optimize.anonymous < LIMITS.compute.anonymous);

    for (const rule of Object.values(LIMITS)) {
        assert.ok(rule.signedIn > rule.anonymous, `${rule.name} must reward signing in`);
        assert.ok(rule.anonymous > 0, `${rule.name} must not lock everyone out`);
    }
});
