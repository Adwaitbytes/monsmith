/**
 * Card payments for reports, through Dodo Payments.
 *
 * Every rule here exists to stop one of two failures: a report unlocking without
 * money having moved, or money moving without the report unlocking. The first is
 * a leak and the second is theft from a customer, so both directions are tested.
 *
 * The decisions live in pure functions so they can be tested without a network,
 * a database or a signing secret. The signature tests at the end use a real
 * Standard Webhooks signer, because verification is the one part that has to be
 * exercised with real cryptography rather than trusted.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Webhook } from "standardwebhooks";

import {
    REPORT_UNLOCK_PURPOSE,
    checkoutMetadata,
    decideWebhook,
    unlockFromPayment,
    verifyWebhook,
    type PaymentLike,
} from "../lib/billing/reportPayments.ts";

const PRODUCT = "pdt_report_unlock";
const REPORT = "8f7b2a1c-0d3e-4c5b-9a6f-1e2d3c4b5a69";

function payment(overrides: Partial<PaymentLike> = {}): PaymentLike {
    return {
        payment_id: "pay_abc123",
        status: "succeeded",
        total_amount: 4900,
        currency: "USD",
        product_cart: [{ product_id: PRODUCT, quantity: 1 }],
        metadata: checkoutMetadata(REPORT, { userId: "user_1", visitorId: "v_1" }),
        ...overrides,
    };
}

// ============= CHECKOUT METADATA =============

test("checkout metadata names the report and the owner, and marks its purpose", () => {
    const meta = checkoutMetadata(REPORT, { userId: "user_1", visitorId: "v_1" });
    assert.equal(meta.purpose, REPORT_UNLOCK_PURPOSE);
    assert.equal(meta.report_id, REPORT);
    assert.equal(meta.user_id, "user_1");
    assert.equal(meta.visitor_id, "v_1");
});

test("an anonymous owner leaves the missing half out rather than writing a literal null", () => {
    const meta = checkoutMetadata(REPORT, { userId: null, visitorId: "v_1" });
    assert.equal("user_id" in meta, false);
    assert.equal(meta.visitor_id, "v_1");
});

// ============= WHAT A PAYMENT UNLOCKS =============

test("a succeeded payment for the report product unlocks the report it names", () => {
    const result = unlockFromPayment(payment(), PRODUCT);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.unlock.reportId, REPORT);
    assert.equal(result.unlock.paymentId, "pay_abc123");
    assert.equal(result.unlock.amountMinor, 4900);
    assert.equal(result.unlock.currency, "USD");
    assert.deepEqual(result.unlock.owner, { userId: "user_1", visitorId: "v_1" });
});

test("a payment that has not succeeded unlocks nothing", () => {
    for (const status of ["processing", "failed", "cancelled", "requires_customer_action", null]) {
        const result = unlockFromPayment(payment({ status }), PRODUCT);
        assert.equal(result.ok, false, `status ${status} must not unlock`);
    }
});

test("a payment for a different product unlocks nothing, even with our metadata on it", () => {
    const result = unlockFromPayment(payment({ product_cart: [{ product_id: "pdt_something_else", quantity: 1 }] }), PRODUCT);
    assert.equal(result.ok, false);
});

test("a payment with no product cart unlocks nothing", () => {
    assert.equal(unlockFromPayment(payment({ product_cart: null }), PRODUCT).ok, false);
    assert.equal(unlockFromPayment(payment({ product_cart: [] }), PRODUCT).ok, false);
});

test("a payment that was not created for a report unlock is ignored", () => {
    const meta = { ...checkoutMetadata(REPORT, { userId: null, visitorId: "v_1" }), purpose: "something_else" };
    assert.equal(unlockFromPayment(payment({ metadata: meta }), PRODUCT).ok, false);
});

test("a payment without a report id unlocks nothing", () => {
    const { report_id: _dropped, ...meta } = checkoutMetadata(REPORT, { userId: null, visitorId: "v_1" });
    assert.equal(unlockFromPayment(payment({ metadata: meta }), PRODUCT).ok, false);
});

test("a malformed report id is refused rather than written to the database", () => {
    const meta = { ...checkoutMetadata(REPORT, { userId: null, visitorId: "v_1" }), report_id: "x'; DROP TABLE reports; --" };
    assert.equal(unlockFromPayment(payment({ metadata: meta }), PRODUCT).ok, false);
});

test("a zero amount unlocks nothing, so a 100% discount cannot be minted by accident", () => {
    assert.equal(unlockFromPayment(payment({ total_amount: 0 }), PRODUCT).ok, false);
});

// ============= WEBHOOK DECISIONS =============

test("payment.succeeded becomes an unlock", () => {
    const decision = decideWebhook({ type: "payment.succeeded", data: payment() }, PRODUCT);
    assert.equal(decision.kind, "unlock");
});

test("payment.succeeded for someone else's product is ignored, not an error", () => {
    const decision = decideWebhook({ type: "payment.succeeded", data: payment({ product_cart: [{ product_id: "pdt_other", quantity: 1 }] }) }, PRODUCT);
    assert.equal(decision.kind, "ignore");
});

test("a full refund takes the report back", () => {
    const decision = decideWebhook({ type: "refund.succeeded", data: { payment_id: "pay_abc123", is_partial: false, status: "succeeded" } }, PRODUCT);
    assert.deepEqual(decision, { kind: "revoke", paymentId: "pay_abc123", reason: "refunded" });
});

test("a partial refund leaves the report unlocked", () => {
    const decision = decideWebhook({ type: "refund.succeeded", data: { payment_id: "pay_abc123", is_partial: true, status: "succeeded" } }, PRODUCT);
    assert.equal(decision.kind, "ignore");
});

test("a lost dispute takes the report back", () => {
    const decision = decideWebhook({ type: "dispute.lost", data: { payment_id: "pay_abc123" } }, PRODUCT);
    assert.deepEqual(decision, { kind: "revoke", paymentId: "pay_abc123", reason: "dispute_lost" });
});

test("events this product does not act on are ignored", () => {
    for (const type of ["payment.failed", "payment.processing", "subscription.active", "dispute.opened", "payout.success"]) {
        assert.equal(decideWebhook({ type, data: {} }, PRODUCT).kind, "ignore", type);
    }
});

// ============= SIGNATURES =============

const SECRET = `whsec_${Buffer.from("monsmith-test-signing-key-32bytes!").toString("base64")}`;

function signed(body: string, id = "msg_1", at = new Date()) {
    const signature = new Webhook(SECRET).sign(id, at, body);
    return {
        "webhook-id": id,
        "webhook-timestamp": String(Math.floor(at.getTime() / 1000)),
        "webhook-signature": signature,
    };
}

test("a correctly signed webhook verifies and parses", () => {
    const body = JSON.stringify({ type: "payment.succeeded", data: payment() });
    const event = verifyWebhook(body, signed(body), SECRET);
    assert.notEqual(event, null);
    assert.equal(event?.type, "payment.succeeded");
    assert.equal(event?.webhookId, "msg_1");
});

test("a body changed after signing is rejected", () => {
    const body = JSON.stringify({ type: "payment.succeeded", data: payment() });
    const headers = signed(body);
    const tampered = body.replace("4900", "1");
    assert.equal(verifyWebhook(tampered, headers, SECRET), null);
});

test("a webhook signed with a different secret is rejected", () => {
    const body = JSON.stringify({ type: "payment.succeeded", data: payment() });
    const other = `whsec_${Buffer.from("an-attacker-controlled-secret-32b").toString("base64")}`;
    const headers = { ...signed(body), "webhook-signature": new Webhook(other).sign("msg_1", new Date(), body) };
    assert.equal(verifyWebhook(body, headers, SECRET), null);
});

test("a replayed webhook older than the tolerance is rejected", () => {
    const body = JSON.stringify({ type: "payment.succeeded", data: payment() });
    const stale = new Date(Date.now() - 60 * 60 * 1000);
    assert.equal(verifyWebhook(body, signed(body, "msg_1", stale), SECRET), null);
});

test("missing signature headers are rejected, not treated as unsigned", () => {
    const body = JSON.stringify({ type: "payment.succeeded", data: payment() });
    assert.equal(verifyWebhook(body, {}, SECRET), null);
});
