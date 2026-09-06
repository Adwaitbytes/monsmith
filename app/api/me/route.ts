import { NextResponse } from "next/server";

import { getViewer } from "@/lib/auth/server";

/**
 * Who is asking, and what they are allowed to do.
 *
 * Client components need the role and tier to decide what to render, and
 * deriving that in the browser from a token would mean trusting the browser
 * with the answer. So the resolution stays on the server and the client is told
 * the result.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const viewer = await getViewer();

    return NextResponse.json(
        {
            signedIn: viewer.signedIn,
            userId: viewer.userId,
            email: viewer.email,
            role: viewer.role,
            tier: viewer.tier,
            permissions: viewer.permissions,
            limits: viewer.limits,
        },
        // Per-user, so a shared cache must never hold it.
        { headers: { "Cache-Control": "private, no-store" } },
    );
}
