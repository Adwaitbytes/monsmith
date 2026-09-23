import { NextResponse } from "next/server";

/**
 * Which voice agent to connect a visitor to.
 *
 * There are two, staffed for different regions, and the right one depends on
 * where the caller is. That has to be decided on the server: a browser cannot
 * see its own public address, and the timezone it will happily report is a
 * setting rather than a location. The platform already puts the country in a
 * request header, so the answer is free and arrives with the request.
 *
 * The number itself never reaches the client until it is asked for, which keeps
 * both links out of the page source for anyone reading it to find the other
 * region's line.
 *
 * Failure resolves to the international agent rather than to an error. Somebody
 * who wants to talk to a person should get a person, and being routed to the
 * wrong desk is a far smaller problem than a button that does nothing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENTS = {
    india: "https://salesagent-yhc9.onrender.com/call/36c922fee9f6",
    international: "https://salesagent-yhc9.onrender.com/call/664ac87d0463",
} as const;

export type AgentRegion = keyof typeof AGENTS;

/**
 * The country the request came from.
 *
 * Vercel sets `x-vercel-ip-country`; the Cloudflare header is honoured too
 * because a deployment behind it would otherwise always look international.
 * Locally neither exists, which is why the fallback has to be a sensible
 * destination rather than a failure.
 */
function countryOf(req: Request): string | null {
    const headers = req.headers;
    const country =
        headers.get("x-vercel-ip-country") ??
        headers.get("cf-ipcountry") ??
        headers.get("x-country-code");

    if (country === null) return null;
    const code = country.trim().toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function GET(req: Request) {
    const country = countryOf(req);
    const region: AgentRegion = country === "IN" ? "india" : "international";

    return NextResponse.json(
        { url: AGENTS[region], region, country },
        // Per-visitor, so it must never be cached at the edge and served to
        // someone in another country.
        { headers: { "Cache-Control": "private, no-store" } },
    );
}
