import { NextResponse } from "next/server";

import { dodoConfig, reportPrice } from "@/lib/billing/dodo";
import { entitlementFor, REPORT_PAYEE, REPORT_PRICE_MON, REPORT_PRICE_WEI } from "@/lib/report/entitlement";
import { FREE_REPORTS } from "@/lib/report/freeReports";
import { redactReport, summariseLocked } from "@/lib/report/redact";
import { loadReport, type StoredReport } from "@/lib/report/store";

/**
 * Reading a stored report.
 *
 * The permalink behind every report the product produces, and the surface the
 * paywall actually defends. A report is written to the database whole and
 * leaves this route through `redactReport`, which is the only code allowed to
 * decide what an unentitled viewer sees.
 *
 * The structure of this handler is the security property. There is exactly one
 * statement in the file that puts report data into a response, it takes its
 * `entitled` argument from `entitlementFor` rather than from anything the
 * caller sent, and every other exit path returns an error object with no report
 * in it. A second success path is how a paid field eventually escapes: someone
 * adds an early return for a cache hit or a debug flag and forgets the
 * redaction. There is no second path to forget.
 */

export const runtime = "nodejs";

export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    // Route params are a promise in this version of Next. Awaiting is not
    // optional: the unresolved object has no `id` and would read as undefined.
    const { id } = await params;

    if (id.length === 0) {
        return NextResponse.json({ error: "Report id is required" }, { status: 400 });
    }

    let stored: StoredReport | null;
    try {
        stored = await loadReport(id);
    } catch (error) {
        // A database that cannot be read is a server fault, not a missing
        // report. Reporting it as a 404 would send someone looking for a
        // permalink they in fact still have.
        console.error(`Report read failed for ${id}:`, error);
        return NextResponse.json(
            { error: "Could not read the report store" },
            { status: 503 },
        );
    }

    if (stored === null) {
        return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const { entitled, reason, owner } = await entitlementFor(id, req);

    // The upsell numbers are counted from the unredacted report on purpose.
    // They are counts and flags rather than content, so the promise of what
    // unlocking adds cannot drift from what the paid report actually holds.
    const summary = summariseLocked(stored.report);

    // Card checkout is offered only when Dodo is configured and the product has a
    // readable one-time price. The number comes from Dodo, so it cannot disagree
    // with what the checkout charges.
    const dodo = entitled ? null : dodoConfig();
    const card = dodo === null ? null : await reportPrice(dodo);

    return NextResponse.json({
        report: redactReport(stored.report, entitled),
        locked: !entitled,
        reason,
        // Locked for a signed-out visitor who would get this report free by
        // signing in. The interface leads with that, before any price.
        signInForFree: !entitled && owner.userId === null && FREE_REPORTS > 0,
        freeReports: FREE_REPORTS,
        summary,
        price: entitled
            ? null
            : { wei: REPORT_PRICE_WEI, mon: REPORT_PRICE_MON, payee: REPORT_PAYEE, card },
    });
}
