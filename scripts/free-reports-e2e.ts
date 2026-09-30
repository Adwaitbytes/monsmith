// Cross-checks the free allowance against the real database.
//
// A visitor runs three reports signed out, then signs in. Signed out, nothing is
// free. Signed in, their first two reports (adopted from the browser) are free
// and the third is not. A report that already belongs to someone else is never
// adopted, whatever visitor id arrives. Every row written is deleted at the end.
//
// usage: node --import tsx --import ./tests/register.mjs scripts/free-reports-e2e.ts
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const { neon } = await import("@neondatabase/serverless");
const { isUnlocked } = await import("../lib/report/store.ts");

const sql = neon(process.env.DATABASE_URL!);
const visitor = `e2e-visitor-${Date.now()}`;
const user = `e2e-user-${Date.now()}`;
const stranger = `e2e-stranger-${Date.now()}`;
const mine = [randomUUID(), randomUUID(), randomUUID()];
const theirs = randomUUID();
let failures = 0;

function check(label: string, ok: boolean) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) failures++;
}

const [src] = (await sql`SELECT origin, payload FROM reports ORDER BY created_at DESC LIMIT 1`) as Array<{ origin: unknown; payload: Record<string, unknown> }>;

try {
    for (const [i, id] of mine.entries()) {
        await sql`INSERT INTO reports (report_id, visitor_id, origin, payload, created_at)
                  VALUES (${id}, ${visitor}, ${src.origin}, ${{ ...src.payload, reportId: id }}, NOW() - ${`${10 - i} minutes`}::interval)`;
    }
    // Same browser, but this report already belongs to another account.
    await sql`INSERT INTO reports (report_id, user_id, visitor_id, origin, payload, created_at)
              VALUES (${theirs}, ${stranger}, ${visitor}, ${src.origin}, ${{ ...src.payload, reportId: theirs }}, NOW() - '20 minutes'::interval)`;

    const signedOut = { userId: null, visitorId: visitor };
    for (const [i, id] of mine.entries()) {
        check(`signed out, report ${i + 1} is locked`, (await isUnlocked(id, signedOut, false)) === false);
    }

    const signedIn = { userId: user, visitorId: visitor };
    check("signed in, report 1 is free", await isUnlocked(mine[0], signedIn, false));
    check("signed in, report 2 is free", await isUnlocked(mine[1], signedIn, false));
    check("signed in, report 3 is not free", (await isUnlocked(mine[2], signedIn, false)) === false);

    const owners = (await sql`SELECT report_id, user_id FROM reports WHERE report_id = ANY(${[...mine, theirs]})`) as Array<{ report_id: string; user_id: string }>;
    const byId = Object.fromEntries(owners.map((o) => [o.report_id, o.user_id]));
    check("the browser's reports were adopted by the account", mine.every((id) => byId[id] === user));
    check("a report already owned by another account was not moved", byId[theirs] === stranger);
    check("the other account's report is not free for this user", (await isUnlocked(theirs, signedIn, false)) === false);
} finally {
    await sql`DELETE FROM reports WHERE report_id = ANY(${[...mine, theirs]})`;
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
