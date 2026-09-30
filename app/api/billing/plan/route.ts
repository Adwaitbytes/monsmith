import { NextResponse } from "next/server";

import { dodoConfig, reportPrice } from "@/lib/billing/dodo";
import type { Plan } from "@/lib/billing/offer";
import { paywallEnabled } from "@/lib/report/entitlement";
import { FREE_REPORTS } from "@/lib/report/freeReports";

/**
 * The offer, before anyone has run a report.
 *
 * The start screen states the price up front, and it has to be the price the
 * server will actually charge, so it is read from the same config and the same
 * Dodo product the checkout uses rather than written into the page. Nothing
 * here is per-person, which is why it can be cached at the edge.
 */

export const runtime = "nodejs";

export async function GET() {
    const paywall = paywallEnabled();
    const config = paywall ? dodoConfig() : null;
    const plan: Plan = {
        paywall,
        freeReports: FREE_REPORTS,
        price: config === null ? null : await reportPrice(config),
    };
    return NextResponse.json(plan, {
        headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
}
