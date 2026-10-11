import { NextResponse } from "next/server";

import { can, parseTier } from "@/lib/auth/roles";
import { privy } from "@/lib/auth/privy";
import { getViewer } from "@/lib/auth/server";

/**
 * Sets an account's tier.
 *
 * The permission is checked here rather than relying on the proxy having
 * matched the path. A route that authorises itself keeps working when someone
 * later changes a matcher, which is exactly the kind of edit that silently
 * opens a hole.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
    const viewer = await getViewer();
    if (!can(viewer, "admin.billing")) {
        return NextResponse.json({ success: false, error: "Not permitted" }, { status: 403 });
    }

    let body: { userId?: unknown; tier?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ success: false, error: "Malformed body" }, { status: 400 });
    }

    if (typeof body.userId !== "string" || body.userId.length === 0) {
        return NextResponse.json({ success: false, error: "userId is required" }, { status: 400 });
    }
    // Anything unrecognised becomes "free" rather than being written through.
    const tier = parseTier(body.tier);

    try {
        const users = privy().users();
        const user = await users._get(body.userId);
        await users.setCustomMetadata(body.userId, { custom_metadata: { ...(user.custom_metadata ?? {}), tier } });
        return NextResponse.json({ success: true, tier });
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Update failed" },
            { status: 500 },
        );
    }
}
