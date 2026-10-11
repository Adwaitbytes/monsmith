import { NextResponse } from "next/server";
import { isAddress, type Address, type Hex } from "viem";

import {
    AGENT_REGISTRY_ID,
    attestationOfDeployment,
    attestationOfSource,
    attestConfig,
    EXPLORER,
    type OnchainAttestation,
} from "@/lib/attest/chain";
import { reportHash } from "@/lib/attest/hash";
import { isReportId } from "@/lib/billing/reportPayments";
import { LIMITS, rateLimit, tooManyRequests } from "@/lib/rateLimit";
import { loadReport } from "@/lib/report/store";

/**
 * Has this contract been audited by Monsmith, and how did it score?
 *
 * The question a wallet or an agent asks before it calls a contract. The answer
 * is read from the attestations contract on Monad mainnet, not from this
 * site's database, and the report it points to is hashed again and compared
 * with what was attested, so a reader can tell the report was not changed
 * after it was published. Open to any origin, since agents call it from
 * anywhere.
 *
 *   GET /api/verify?source=0x<keccak256 of the source file>
 *   GET /api/verify?chainId=143&address=0x<deployed contract>
 */

export const runtime = "nodejs";

const CORS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, s-maxage=30" };

function reply(body: unknown, status = 200) {
    return NextResponse.json(body, { status, headers: CORS });
}

async function reportMatches(attestation: OnchainAttestation): Promise<boolean | null> {
    const id = attestation.reportURI.split("/report/")[1]?.split(/[?#]/)[0] ?? "";
    if (!isReportId(id)) return null;
    const stored = await loadReport(id).catch(() => null);
    if (stored === null) return null;
    return reportHash(stored.report) === attestation.reportHash;
}

export async function GET(req: Request) {
    const config = attestConfig();
    if (config === null) return reply({ error: "Onchain attestations are not set up on this deployment." }, 503);

    const budget = await rateLimit(req, LIMITS.compute, null);
    if (!budget.ok) return tooManyRequests(budget, "verifications");

    const query = new URL(req.url).searchParams;
    const source = query.get("source");
    const address = query.get("address");
    const chainId = Number(query.get("chainId") ?? "143");

    let attestation: OnchainAttestation | null;
    try {
        if (source !== null) {
            if (!/^0x[0-9a-fA-F]{64}$/.test(source)) return reply({ error: "source must be a 32-byte hex hash." }, 400);
            attestation = await attestationOfSource(config, source as Hex);
        } else if (address !== null) {
            if (!isAddress(address) || !Number.isInteger(chainId) || chainId <= 0) {
                return reply({ error: "Give a valid chainId and address." }, 400);
            }
            attestation = await attestationOfDeployment(config, chainId, address as Address);
        } else {
            return reply({ error: "Ask about a source hash (?source=) or a deployed contract (?chainId=&address=)." }, 400);
        }
    } catch (error) {
        console.error("Verify: reading Monad failed:", error);
        return reply({ error: "Could not read Monad right now. Try again in a moment." }, 502);
    }

    const agent = { agentId: config.agentId.toString(), registry: AGENT_REGISTRY_ID };
    if (attestation === null) {
        return reply({ attested: false, agent, contract: config.address });
    }
    return reply({
        attested: true,
        agent,
        contract: config.address,
        contractUrl: `${EXPLORER}/address/${config.address}`,
        attestation: { ...attestation, attestedAt: new Date(attestation.timestamp * 1000).toISOString() },
        reportMatches: await reportMatches(attestation),
    });
}
