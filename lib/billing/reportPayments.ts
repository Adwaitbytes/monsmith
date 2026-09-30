/**
 * The rules for paying for a report by card, through Dodo Payments.
 *
 * Kept free of network, database and framework so every rule can be tested on
 * its own. The routes do the I/O; this module decides. Two failures matter and
 * everything here exists to prevent one of them:
 *
 * - a report unlocking without money having moved, which is a leak, and
 * - money moving without the report unlocking, which takes a customer's money
 *   and gives them nothing.
 *
 * The first is stopped by trusting only what Dodo signed or returned from its own
 * API, and by checking the product and the status rather than the presence of our
 * metadata. The second is stopped by two independent paths to the same unlock:
 * the signed webhook, and a server-side lookup when the customer returns from
 * checkout. Both write the same idempotent row.
 */

import { Webhook } from "standardwebhooks";

import type { ReportOwner } from "../report/store";

/**
 * Marks a checkout as a report unlock.
 *
 * The same Dodo account may one day sell other things. A payment only unlocks a
 * report when it was created for that purpose AND bought the report product, so
 * neither a stray metadata key nor a different product can open a report.
 */
export const REPORT_UNLOCK_PURPOSE = "report_unlock";

/** `crypto.randomUUID()` output, which is how reports are named. */
const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Dodo payment ids, as returned on the checkout return URL. */
const PAYMENT_ID = /^pay_[A-Za-z0-9]{6,64}$/;

export function isReportId(value: unknown): value is string {
    return typeof value === "string" && REPORT_ID.test(value);
}

export function isPaymentId(value: unknown): value is string {
    return typeof value === "string" && PAYMENT_ID.test(value);
}

// ============= CHECKOUT =============

export type CheckoutMetadata = Record<string, string>;

/**
 * What a checkout session carries, set by this server when it creates the
 * session. Dodo returns it unchanged on the payment and on every webhook, which
 * is how a payment finds its way back to the report and the person who bought it.
 * Owner halves that are unknown are left out: Dodo metadata is string-only, and a
 * literal "null" would later read as a real id.
 */
export function checkoutMetadata(reportId: string, owner: ReportOwner): CheckoutMetadata {
    const meta: CheckoutMetadata = { purpose: REPORT_UNLOCK_PURPOSE, report_id: reportId };
    if (owner.userId !== null) meta.user_id = owner.userId;
    if (owner.visitorId !== null) meta.visitor_id = owner.visitorId;
    return meta;
}

// ============= PAYMENTS =============

/** The fields of a Dodo `Payment` these rules read, whichever path it came by. */
export interface PaymentLike {
    payment_id: string;
    status?: string | null;
    total_amount: number;
    currency: string;
    product_cart?: Array<{ product_id: string; quantity: number }> | null;
    metadata?: Record<string, string> | null;
}

export interface PaidUnlock {
    reportId: string;
    owner: ReportOwner;
    paymentId: string;
    amountMinor: number;
    currency: string;
}

export type UnlockResult = { ok: true; unlock: PaidUnlock } | { ok: false; reason: string };

/**
 * The unlock a payment pays for, or why it pays for none.
 *
 * Every condition is required. Status, because a payment in `processing` can
 * still fail. Product, because metadata alone is not proof of what was bought.
 * A positive amount, because a 100% discount code would otherwise mint free
 * unlocks. A well-formed report id, because it is about to be written to the
 * database and it came back from a third party.
 */
export function unlockFromPayment(payment: PaymentLike, productId: string): UnlockResult {
    if (payment.status !== "succeeded") return { ok: false, reason: `payment status is ${payment.status ?? "unknown"}` };

    const meta = payment.metadata ?? {};
    if (meta.purpose !== REPORT_UNLOCK_PURPOSE) return { ok: false, reason: "not a report unlock" };
    if (!isReportId(meta.report_id)) return { ok: false, reason: "no valid report id" };

    const bought = (payment.product_cart ?? []).some((item) => item.product_id === productId && item.quantity > 0);
    if (!bought) return { ok: false, reason: "the report product is not in the cart" };

    if (!(payment.total_amount > 0)) return { ok: false, reason: "zero amount" };

    return {
        ok: true,
        unlock: {
            reportId: meta.report_id,
            owner: { userId: meta.user_id ?? null, visitorId: meta.visitor_id ?? null },
            paymentId: payment.payment_id,
            amountMinor: payment.total_amount,
            currency: payment.currency,
        },
    };
}

// ============= WEBHOOKS =============

export interface WebhookEvent {
    type: string;
    data: unknown;
}

export type WebhookDecision =
    | { kind: "unlock"; unlock: PaidUnlock }
    | { kind: "revoke"; paymentId: string; reason: "refunded" | "dispute_lost" }
    | { kind: "ignore"; reason: string };

function record(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * What a verified webhook means for reports.
 *
 * A full refund or a lost dispute takes the report back: the customer has their
 * money, so they no longer have the report. A partial refund is a goodwill
 * gesture and leaves it unlocked. Everything else, including failures, is
 * acknowledged and ignored, so Dodo stops retrying events we do not act on.
 */
export function decideWebhook(event: WebhookEvent, productId: string): WebhookDecision {
    const data = record(event.data);

    switch (event.type) {
        case "payment.succeeded": {
            const result = unlockFromPayment(data as unknown as PaymentLike, productId);
            return result.ok ? { kind: "unlock", unlock: result.unlock } : { kind: "ignore", reason: result.reason };
        }
        case "refund.succeeded": {
            if (data.is_partial === true) return { kind: "ignore", reason: "partial refund" };
            if (!isPaymentId(data.payment_id)) return { kind: "ignore", reason: "refund without a payment id" };
            return { kind: "revoke", paymentId: data.payment_id, reason: "refunded" };
        }
        case "dispute.lost": {
            if (!isPaymentId(data.payment_id)) return { kind: "ignore", reason: "dispute without a payment id" };
            return { kind: "revoke", paymentId: data.payment_id, reason: "dispute_lost" };
        }
        default:
            return { kind: "ignore", reason: `unhandled event ${event.type}` };
    }
}

export interface VerifiedWebhook extends WebhookEvent {
    webhookId: string;
}

/**
 * The event, when the body is exactly what Dodo signed, recently; otherwise null.
 *
 * Standard Webhooks: HMAC-SHA256 over `id.timestamp.body` with the `whsec_`
 * secret, and a five minute window against replays. The raw body is verified
 * before it is parsed, because parsing and re-serialising changes the bytes.
 * Any failure, including missing headers, is a rejection: an unsigned request is
 * never treated as a trusted one.
 */
export function verifyWebhook(rawBody: string, headers: Record<string, string>, secret: string): VerifiedWebhook | null {
    const id = headers["webhook-id"];
    const timestamp = headers["webhook-timestamp"];
    const signature = headers["webhook-signature"];
    if (!id || !timestamp || !signature) return null;

    try {
        const parsed = new Webhook(secret).verify(rawBody, {
            "webhook-id": id,
            "webhook-timestamp": timestamp,
            "webhook-signature": signature,
        }) as Record<string, unknown>;
        if (typeof parsed.type !== "string") return null;
        return { type: parsed.type, data: parsed.data, webhookId: id };
    } catch {
        return null;
    }
}
