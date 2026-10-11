import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import { LIMITS, rateLimit, tooManyRequests } from "@/lib/rateLimit";
import { nansenChain, stakeOf } from "@/lib/stake/nansen";

/**
 * What is at stake in a deployed contract: what it holds and who it deals
 * with, from Nansen. Shown next to an audit so a finding can be weighed by the
 * money behind it.
 *
 *   GET /api/stake?chainId=143&address=0x...
 *
 * Nansen charges per call, so answers are cached at the edge for an hour.
 */

export const runtime = "nodejs";

const HEADERS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };

export async function GET(req: Request) {
    const query = new URL(req.url).searchParams;
    const address = query.get("address") ?? "";
    const chainId = Number(query.get("chainId") ?? "143");
    if (!isAddress(address) || !Number.isInteger(chainId)) {
        return NextResponse.json({ error: "Give a valid chainId and address." }, { status: 400 });
    }
    if (nansenChain(chainId) === null) {
        return NextResponse.json({ error: "No onchain intelligence for this chain." }, { status: 404, headers: HEADERS });
    }

    const budget = await rateLimit(req, LIMITS.compute, null);
    if (!budget.ok) return tooManyRequests(budget, "stake lookups");

    try {
        const stake = await stakeOf(chainId, getAddress(address));
        if (stake === null) return NextResponse.json({ error: "Onchain intelligence is not set up on this deployment." }, { status: 503 });
        return NextResponse.json(stake, { headers: HEADERS });
    } catch (error) {
        console.error("Stake: reading Nansen failed:", error);
        return NextResponse.json({ error: "Could not read onchain intelligence right now." }, { status: 502 });
    }
}
