import { NextResponse } from "next/server";

import { AGENT_REGISTRY_ID, attestConfig } from "@/lib/attest/chain";
import { siteUrl } from "@/lib/siteUrl";

/**
 * Monsmith's ERC-8004 agent registration file.
 *
 * The Identity Registry entry points here. It says what the agent is, where to
 * reach it, and which registration it belongs to, in the shape the standard
 * defines, so other agents and indexers can discover Monsmith as an auditor
 * and find its attestations.
 */

export const runtime = "nodejs";

export function GET() {
    const site = siteUrl();
    const config = attestConfig();
    return NextResponse.json(
        {
            type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
            name: "Monsmith",
            description:
                "Smart contract auditor for Monad. Audits Solidity for security, gas, parallel execution and chain cost, optimizes it, and attests each audit onchain on Monad so wallets and agents can check a contract before they call it.",
            image: `${site}/monsmith-logo.svg`,
            services: [
                { name: "web", endpoint: `${site}/studio` },
                { name: "verify", endpoint: `${site}/api/verify`, version: "1" },
                ...(config === null ? [] : [{ name: "attestations", endpoint: `eip155:143:${config.address}` }]),
            ],
            x402Support: false,
            active: true,
            registrations: config === null ? [] : [{ agentId: Number(config.agentId), agentRegistry: AGENT_REGISTRY_ID }],
            supportedTrust: ["reputation"],
        },
        { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, s-maxage=300" } },
    );
}
