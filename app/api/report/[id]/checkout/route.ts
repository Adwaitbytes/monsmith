import { NextResponse } from "next/server";

import { getApiViewer } from "@/lib/auth/server";
import { dodoClient, dodoConfig } from "@/lib/billing/dodo";
import { checkoutMetadata, isReportId } from "@/lib/billing/reportPayments";
import { LIMITS, rateLimit, tooManyRequests } from "@/lib/rateLimit";
import { entitlementFor, paywallEnabled } from "@/lib/report/entitlement";
import { loadReport, type StoredReport } from "@/lib/report/store";
import { siteUrl } from "@/lib/siteUrl";

/**
 * Starting a card payment for a report.
 *
 * Creates a Dodo hosted checkout for the one product that unlocks one report and
 * hands back its URL. Nothing is unlocked here: this route only opens the door.
 * The unlock happens when Dodo says the money moved, through the signed webhook
 * or the confirm route the customer lands on afterwards.
 *
 * What the customer buys is fixed by the server. The product id, and so the
 * price, comes from the environment; the report id and the owner are written
 * into the session metadata by this route, and Dodo returns them unchanged on
 * the payment. Nothing in the request body is read at all.
 */

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    if (!isReportId(id)) {
        return NextResponse.json({ success: false, error: "That is not a report id." }, { status: 400 });
    }

    // With the paywall off every report is already whole, so there is nothing to
    // sell. Saying so beats an error the client would have to explain.
    if (!paywallEnabled()) {
        return NextResponse.json({ success: true, alreadyUnlocked: true });
    }

    const config = dodoConfig();
    if (config === null) {
        return NextResponse.json(
            { success: false, error: "Card payments are not set up on this deployment." },
            { status: 503 },
        );
    }

    const viewer = await getApiViewer();
    const budget = await rateLimit(req, LIMITS.checkout, viewer.userId);
    if (!budget.ok) return tooManyRequests(budget, "checkouts");

    let stored: StoredReport | null;
    try {
        stored = await loadReport(id);
    } catch (error) {
        console.error(`Checkout ${id}: could not read the report store:`, error);
        return NextResponse.json({ success: false, error: "Could not read the report store" }, { status: 503 });
    }
    if (stored === null) {
        return NextResponse.json({ success: false, error: "Report not found" }, { status: 404 });
    }

    // Charging someone for a report they can already read is the worst bug this
    // path can have, so entitlement is checked before a session exists.
    const { entitled, owner } = await entitlementFor(id, req);
    if (entitled) {
        return NextResponse.json({ success: true, alreadyUnlocked: true });
    }

    try {
        const session = await dodoClient(config).checkoutSessions.create({
            product_cart: [{ product_id: config.productId, quantity: 1 }],
            metadata: checkoutMetadata(id, owner),
            return_url: `${siteUrl()}/report/${id}?checkout=return`,
            cancel_url: `${siteUrl()}/report/${id}?checkout=cancelled`,
            ...(viewer.email !== null ? { customer: { email: viewer.email } } : {}),
        });

        if (!session.checkout_url) {
            console.error(`Checkout ${id}: Dodo created session ${session.session_id} without a checkout URL`);
            return NextResponse.json({ success: false, error: "The payment page could not be opened." }, { status: 502 });
        }

        return NextResponse.json({ success: true, checkoutUrl: session.checkout_url, sessionId: session.session_id });
    } catch (error) {
        console.error(`Checkout ${id}: Dodo refused to create a session:`, error);
        return NextResponse.json({ success: false, error: "The payment page could not be opened. Try again in a moment." }, { status: 502 });
    }
}
