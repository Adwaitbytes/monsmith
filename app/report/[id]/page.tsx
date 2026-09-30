import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { SiteFooter, SiteNav } from "../../SiteChrome";
import { loadReport } from "@/lib/report/store";
import { redactReport } from "@/lib/report/redact";
import { entitlementFor } from "@/lib/report/entitlement";
import { ReportView, type CheckoutReturn } from "./ReportView";

/**
 * A report at its own address.
 *
 * The share button copied a link to this page before the page existed, which is
 * the kind of mistake that only shows up when somebody actually uses the
 * button. It exists now, and it is a real page rather than a redirect into the
 * studio: a report someone shares is usually going to a reviewer or a teammate
 * who has no interest in opening an IDE, and dropping them into a code editor
 * to read a document would be the wrong welcome.
 *
 * Rendering happens on the server so the report is in the HTML. That matters
 * for a link posted anywhere that unfurls it, and it means a reader with a
 * slow connection sees the findings rather than a loading state.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PageProps {
    params: Promise<{ id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Dodo returns the customer with `checkout` set by us and `payment_id` added by Dodo. */
function checkoutReturnFrom(query: Record<string, string | string[] | undefined>): CheckoutReturn | null {
    const checkout = query.checkout;
    if (checkout !== "return" && checkout !== "cancelled") return null;
    const payment = query.payment_id;
    const paymentId = checkout === "return" && typeof payment === "string" && payment.length > 0 ? payment : null;
    return { paymentId };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { id } = await params;
    const stored = await loadReport(id).catch(() => null);
    if (stored === null) return { title: "Report not found" };

    const report = stored.report;
    const score = report.health?.score;
    const grade = report.health?.grade;
    const name = report.contracts[0]?.name ?? "Contract";
    const count = report.contracts.length;

    const subject = count > 1 ? `${count} contracts` : name;
    const title =
        score === undefined ? `${subject} audit` : `${subject}: ${score} out of 100 (${grade})`;

    const counts = report.counts;
    const worst =
        counts.critical > 0
            ? `${counts.critical} critical`
            : counts.high > 0
              ? `${counts.high} high`
              : counts.medium > 0
                ? `${counts.medium} medium`
                : "no significant";

    return {
        title,
        description: `Security, gas and parallel execution audit. ${worst} ${counts.critical + counts.high + counts.medium === 1 ? "finding" : "findings"} across ${subject}.`,
        // A shared report should not be indexed: it is somebody's code.
        robots: { index: false, follow: false },
        openGraph: { title, type: "article" },
    };
}

/**
 * The run time, formatted once, on the server.
 *
 * Letting the browser format this was a hydration mismatch waiting to happen,
 * and it duly happened: the server rendered "04:28" and the client "4:28 am",
 * because `toLocaleString` answers to whoever is asking. Fixing the locale and
 * the zone gives one answer, which a shared report wants anyway. Two people in
 * different countries reading the same link should see the same timestamp, and
 * saying UTC out loud is how they both know what it means.
 */
function formatRunTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
    })} UTC`;
}

export default async function ReportPage({ params, searchParams }: PageProps) {
    const { id } = await params;
    const query = await searchParams;
    const checkout = checkoutReturnFrom(query);

    const stored = await loadReport(id).catch(() => null);
    if (stored === null) notFound();

    // Redaction runs here for the same reason it runs in the API: the paid half
    // must not reach the browser, and a shared link is the easiest place to
    // forget that.
    // The real request headers, so a visitor cookie is seen as well as the
    // signed-in account; the entitlement check reads both.
    const { entitled } = await entitlementFor(id, new Request("https://monsmith.com", { headers: await headers() }));
    const report = redactReport(stored.report, entitled);

    return (
        <div className="min-h-screen bg-background text-text-primary">
            <div className="print:hidden">
                <SiteNav />
            </div>
            <ReportView report={report} createdAtLabel={formatRunTime(stored.createdAt)} checkout={checkout} autoPrint={query.print === "1"} />
            <div className="print:hidden">
                <SiteFooter />
            </div>
        </div>
    );
}
