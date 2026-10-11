import { NextResponse } from "next/server";

import { attestConfig, EXPLORER } from "@/lib/attest/chain";
import { readLedger } from "@/lib/attest/ledger";
import { LIMITS, rateLimit, tooManyRequests } from "@/lib/rateLimit";

/**
 * Everything Monsmith has attested on Monad mainnet, newest first.
 *
 * Read through Envio rather than the chain directly, because the public RPC
 * hands out event logs a hundred blocks at a time. Open to any origin, like
 * /api/verify, and cached briefly at the edge since every visitor sees the
 * same ledger.
 *
 *   GET /api/attestations
 */

export const runtime = "nodejs";

const HEADERS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" };

export async function GET(req: Request) {
    const config = attestConfig();
    if (config === null) return NextResponse.json({ error: "Onchain attestations are not set up on this deployment." }, { status: 503, headers: HEADERS });

    const budget = await rateLimit(req, LIMITS.compute, null);
    if (!budget.ok) return tooManyRequests(budget, "ledger reads");

    try {
        const ledger = await readLedger(config);
        if (ledger === null) return NextResponse.json({ error: "The attestation ledger is not set up on this deployment." }, { status: 503, headers: HEADERS });
        return NextResponse.json(
            { ...ledger, contract: config.address, contractUrl: `${EXPLORER}/address/${config.address}`, explorer: EXPLORER },
            { headers: HEADERS },
        );
    } catch (error) {
        console.error("Ledger: reading Envio failed:", error);
        return NextResponse.json({ error: "Could not read the ledger right now." }, { status: 502, headers: HEADERS });
    }
}
