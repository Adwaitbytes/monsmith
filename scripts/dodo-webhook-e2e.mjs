// End-to-end check of card payments against a running dev server.
//
// Sends real Standard Webhooks signed with the server's secret and reads the
// database to confirm what each delivery did. Uses a random report id that does
// not exist, and deletes every row it wrote on the way out.
//
// usage: DODO_PAYMENTS_WEBHOOK_KEY=whsec_... BASE=http://localhost:3100 node scripts/dodo-webhook-e2e.mjs
import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { Webhook } from "standardwebhooks";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const BASE = process.env.BASE ?? "http://localhost:3100";
const SECRET = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
const PRODUCT = process.env.DODO_REPORT_PRODUCT_ID ?? "pdt_e2e_report";
if (!SECRET) throw new Error("DODO_PAYMENTS_WEBHOOK_KEY is required");
const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

const reportId = randomUUID();
const paymentId = `pay_e2e${Date.now()}`;
const ids = [];
let failures = 0;

function check(label, ok, detail = "") {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
    if (!ok) failures++;
}

async function deliver(event, { id = `e2e_${randomUUID()}`, secret = SECRET, at = new Date() } = {}) {
    ids.push(id);
    const body = JSON.stringify({ business_id: "bus_e2e", timestamp: at.toISOString(), ...event });
    const res = await fetch(`${BASE}/api/webhooks/dodo`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "webhook-id": id,
            "webhook-timestamp": String(Math.floor(at.getTime() / 1000)),
            "webhook-signature": new Webhook(secret).sign(id, at, body),
        },
        body,
    });
    return { status: res.status, json: await res.json().catch(() => null), id };
}

const paid = (overrides = {}) => ({
    type: "payment.succeeded",
    data: {
        payload_type: "Payment",
        payment_id: paymentId,
        status: "succeeded",
        total_amount: 4900,
        currency: "USD",
        product_cart: [{ product_id: PRODUCT, quantity: 1 }],
        metadata: { purpose: "report_unlock", report_id: reportId, visitor_id: "v_e2e" },
        ...overrides,
    },
});

async function unlockRow() {
    if (!sql) return null;
    const rows = await sql`SELECT provider, payment_id, amount_minor, currency, visitor_id FROM report_unlocks WHERE report_id = ${reportId}`;
    return rows[0] ?? null;
}

try {
    const forged = await deliver(paid(), { secret: `whsec_${Buffer.from("not-the-real-secret-at-all-32byt").toString("base64")}` });
    check("forged signature is rejected", forged.status === 401, `status ${forged.status}`);

    const stale = await deliver(paid(), { at: new Date(Date.now() - 3600_000) });
    check("hour-old replay is rejected", stale.status === 401, `status ${stale.status}`);

    const other = await deliver(paid({ product_cart: [{ product_id: "pdt_someone_else", quantity: 1 }] }));
    check("payment for another product is acknowledged and ignored", other.status === 200 && other.json?.action === "ignored", JSON.stringify(other.json));

    const first = await deliver(paid());
    check("signed payment.succeeded unlocks", first.status === 200 && first.json?.action === "unlock", JSON.stringify(first.json));

    const row = await unlockRow();
    check("unlock row written with provider, payment and amount",
        row !== null && row.provider === "dodo" && row.payment_id === paymentId && Number(row.amount_minor) === 4900 && row.currency === "USD",
        JSON.stringify(row));

    const retry = await deliver(paid(), { id: first.id });
    check("same delivery retried is a duplicate, not applied twice", retry.status === 200 && retry.json?.action === "duplicate", JSON.stringify(retry.json));

    const again = await deliver(paid());
    check("the same payment in a new delivery is harmless", again.status === 200, JSON.stringify(again.json));

    const partial = await deliver({ type: "refund.succeeded", data: { payload_type: "Refund", payment_id: paymentId, is_partial: true, status: "succeeded" } });
    check("partial refund keeps the report unlocked", partial.json?.action === "ignored" && (await unlockRow()) !== null);

    const refund = await deliver({ type: "refund.succeeded", data: { payload_type: "Refund", payment_id: paymentId, is_partial: false, status: "succeeded" } });
    check("full refund relocks the report", refund.status === 200 && refund.json?.action === "revoke" && (await unlockRow()) === null, JSON.stringify(refund.json));

    const badId = await fetch(`${BASE}/api/report/not-a-report/checkout`, { method: "POST" });
    check("checkout refuses a malformed report id", badId.status === 400, `status ${badId.status}`);

    const missing = await fetch(`${BASE}/api/report/${randomUUID()}/checkout`, { method: "POST" });
    check("checkout for a report that does not exist is a 404, and nothing is sold", missing.status === 404, `status ${missing.status}`);

    const noPayment = await fetch(`${BASE}/api/report/${reportId}/checkout/confirm`, { method: "POST", body: JSON.stringify({ paymentId: "'; DROP TABLE reports;--" }) });
    check("confirm refuses a malformed payment id", noPayment.status === 400, `status ${noPayment.status}`);
} finally {
    if (sql) {
        await sql`DELETE FROM report_unlocks WHERE report_id = ${reportId}`;
        await sql`DELETE FROM processed_webhooks WHERE webhook_id = ANY(${ids})`;
    }
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
