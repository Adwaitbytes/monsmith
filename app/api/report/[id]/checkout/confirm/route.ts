import { NextResponse } from "next/server";

import { dodoClient, dodoConfig } from "@/lib/billing/dodo";
import { isPaymentId, isReportId, unlockFromPayment, type PaymentLike } from "@/lib/billing/reportPayments";
import { entitlementFor, paywallEnabled } from "@/lib/report/entitlement";
import { redactReport } from "@/lib/report/redact";
import { loadReport, recordCardUnlock, type StoredReport } from "@/lib/report/store";

/**
 * Confirming a card payment when the customer returns from checkout.
 *
 * Dodo sends the customer back with `?payment_id=...` in the URL. That value is
 * only a pointer: it came through the browser, so it proves nothing on its own.
 * This route asks Dodo's API for that payment and applies the same rules as the
 * webhook to what Dodo says, then checks the payment was for THIS report.
 *
 * It exists so a customer who just paid sees their report immediately instead of
 * waiting on webhook delivery, and so a webhook outage never leaves someone who
 * paid without what they paid for. Both paths write the same idempotent row.
 */

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    if (!isReportId(id)) {
        return NextResponse.json({ success: false, error: "That is not a report id." }, { status: 400 });
    }

    let paymentId: unknown = null;
    try {
        paymentId = ((await req.json()) as { paymentId?: unknown })?.paymentId;
    } catch {
        paymentId = null;
    }
    if (!isPaymentId(paymentId)) {
        return NextResponse.json({ success: false, error: "A payment id is required." }, { status: 400 });
    }

    let stored: StoredReport | null;
    try {
        stored = await loadReport(id);
    } catch (error) {
        console.error(`Confirm ${id}: could not read the report store:`, error);
        return NextResponse.json({ success: false, error: "Could not read the report store" }, { status: 503 });
    }
    if (stored === null) {
        return NextResponse.json({ success: false, error: "Report not found" }, { status: 404 });
    }

    if (!paywallEnabled()) {
        return NextResponse.json({ success: true, unlocked: true, report: redactReport(stored.report, true) });
    }

    // The webhook usually wins the race. When it has, there is nothing to verify.
    const before = await entitlementFor(id, req);
    if (before.entitled) {
        return NextResponse.json({ success: true, unlocked: true, reason: before.reason, report: redactReport(stored.report, true) });
    }

    const config = dodoConfig();
    if (config === null) {
        return NextResponse.json({ success: false, error: "Card payments are not set up on this deployment." }, { status: 503 });
    }

    let payment: PaymentLike;
    try {
        payment = (await dodoClient(config).payments.retrieve(paymentId)) as PaymentLike;
    } catch (error) {
        console.error(`Confirm ${id}: could not read payment ${paymentId} from Dodo:`, error);
        return NextResponse.json({ success: false, error: "Could not check the payment. Try again in a moment." }, { status: 502 });
    }

    // Still settling: the client polls, and the webhook will land it anyway.
    if (payment.status === "processing" || payment.status === "requires_customer_action") {
        return NextResponse.json({ success: true, unlocked: false, pending: true }, { status: 202 });
    }

    const result = unlockFromPayment(payment, config.productId);
    if (!result.ok) {
        console.error(`Confirm ${id}: payment ${paymentId} does not unlock a report: ${result.reason}`);
        return NextResponse.json({ success: false, unlocked: false, error: "That payment did not go through." }, { status: 402 });
    }

    // A real, paid payment, but for a different report. Never a reason to open this one.
    if (result.unlock.reportId !== id) {
        console.error(`Confirm ${id}: payment ${paymentId} was for report ${result.unlock.reportId}`);
        return NextResponse.json({ success: false, unlocked: false, error: "That payment was for a different report." }, { status: 409 });
    }

    // From here the customer has paid, so the report is owed whatever happens to
    // the write. A failed write is logged for reconciliation and the webhook will
    // retry it; withholding the report would take the money and give nothing back.
    let persisted = true;
    try {
        persisted = await recordCardUnlock(result.unlock);
    } catch (error) {
        persisted = false;
        console.error(`Confirm ${id}: paid by ${paymentId} but the unlock could not be recorded:`, error);
    }

    return NextResponse.json({ success: true, unlocked: true, reason: "paid", persisted, report: redactReport(stored.report, true) });
}
