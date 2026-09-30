import { NextResponse } from "next/server";

import { dodoConfig } from "@/lib/billing/dodo";
import { decideWebhook, verifyWebhook } from "@/lib/billing/reportPayments";
import { claimWebhook, recordCardUnlock, releaseWebhook, revokeCardUnlock } from "@/lib/report/store";

/**
 * Dodo Payments webhooks: the authoritative record of what was paid.
 *
 * Every request is verified against the endpoint's signing secret before its
 * body is parsed, and anything unsigned, altered or older than five minutes is
 * refused with a 401. A verified delivery is claimed by its `webhook-id` so a
 * retry or a duplicate is acknowledged without being applied twice.
 *
 * The status codes are the contract with Dodo's retries. 2xx means done, whether
 * the event unlocked a report or was one we do not act on. 5xx means try again,
 * and is only returned when a write failed, after releasing the claim so the
 * retry can do the work.
 */

export const runtime = "nodejs";

export async function POST(req: Request) {
    const config = dodoConfig();
    if (config === null || config.webhookKey === null) {
        console.error("Dodo webhook received but DODO_PAYMENTS_WEBHOOK_KEY or the product is not configured");
        return NextResponse.json({ error: "Webhooks are not configured" }, { status: 503 });
    }

    // The exact bytes Dodo signed. Parsing first and re-serialising would change them.
    const raw = await req.text();
    const event = verifyWebhook(
        raw,
        {
            "webhook-id": req.headers.get("webhook-id") ?? "",
            "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
            "webhook-signature": req.headers.get("webhook-signature") ?? "",
        },
        config.webhookKey,
    );
    if (event === null) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const decision = decideWebhook(event, config.productId);
    if (decision.kind === "ignore") {
        return NextResponse.json({ received: true, action: "ignored" });
    }

    let fresh: boolean;
    try {
        fresh = await claimWebhook(event.webhookId, event.type);
    } catch (error) {
        console.error(`Dodo webhook ${event.webhookId}: could not claim the delivery:`, error);
        return NextResponse.json({ error: "Temporary failure" }, { status: 503 });
    }
    if (!fresh) {
        return NextResponse.json({ received: true, action: "duplicate" });
    }

    try {
        if (decision.kind === "unlock") {
            await recordCardUnlock(decision.unlock);
            console.info(
                `[dodo] report ${decision.unlock.reportId} unlocked by ${decision.unlock.paymentId} (${decision.unlock.amountMinor} ${decision.unlock.currency})`,
            );
        } else {
            const report = await revokeCardUnlock(decision.paymentId);
            console.info(`[dodo] payment ${decision.paymentId} ${decision.reason}; relocked ${report ?? "nothing"}`);
        }
    } catch (error) {
        console.error(`Dodo webhook ${event.webhookId} (${event.type}): write failed, asking Dodo to retry:`, error);
        await releaseWebhook(event.webhookId).catch((releaseError) =>
            console.error(`Dodo webhook ${event.webhookId}: could not release the claim:`, releaseError),
        );
        return NextResponse.json({ error: "Temporary failure" }, { status: 500 });
    }

    return NextResponse.json({ received: true, action: decision.kind });
}
