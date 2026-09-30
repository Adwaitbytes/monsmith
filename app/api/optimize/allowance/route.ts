import { NextResponse } from "next/server";

import { getApiViewer } from "@/lib/auth/server";
import { FREE_OPTIMIZATIONS } from "@/lib/optimize/allowance";
import { paywallEnabled } from "@/lib/report/entitlement";
import { freeOptimizationsUsed } from "@/lib/report/store";

/**
 * How many free optimizations this viewer has left, for the badge on the
 * button. Null when signed out: the answer then is "sign in and get two", which
 * the button says on its own.
 */

export const runtime = "nodejs";

export async function GET() {
    const viewer = await getApiViewer();
    const paywall = paywallEnabled();
    let freeLeft: number | null = null;
    if (paywall && viewer.userId !== null) {
        try {
            freeLeft = Math.max(0, FREE_OPTIMIZATIONS - (await freeOptimizationsUsed(viewer.userId)));
        } catch (error) {
            console.error("Optimize allowance: could not count optimizations:", error);
        }
    }
    return NextResponse.json(
        { paywall, freeAllowance: FREE_OPTIMIZATIONS, freeLeft, signedIn: viewer.userId !== null },
        { headers: { "Cache-Control": "private, no-store" } },
    );
}
