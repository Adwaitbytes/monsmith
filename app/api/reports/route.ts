import { NextResponse } from "next/server";

import { resolveOwner } from "@/lib/report/entitlement";
import { reportsFor } from "@/lib/report/store";

/**
 * The reports this viewer has produced.
 *
 * Scoped to the caller by construction: the owner comes from the session and
 * the visitor header, never from a query parameter. A history endpoint that
 * takes an id to list by is a history endpoint that lists somebody else's work.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    try {
        const owner = await resolveOwner(req);
        const reports = await reportsFor(owner);
        return NextResponse.json(
            { reports },
            { headers: { "Cache-Control": "private, no-store" } },
        );
    } catch (error) {
        console.error("Report history failed:", error);
        // An unreadable history is an empty one rather than an error page: the
        // list is a convenience and must not take the studio down with it.
        return NextResponse.json({ reports: [] }, { status: 200 });
    }
}
