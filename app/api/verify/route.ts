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
import { CHAIN_KEYS, isStale, staleAnswer } from "@/lib/attest/proxyCheck";
import { lastUpgrade, observeProxy, type ProxyUpgrade } from "@/lib/attest/proxyWatch";
import { deployedCode, supportsChain } from "@/lib/attest/rpc";
import { siteUrl } from "@/lib/siteUrl";
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
 *
 * An address that is an EIP-1967 proxy is always answered for the
 * implementation it points at, and the reply says so (proxyOf), since that is
 * the code a call would actually run. A score bound to the proxy's own address
 * is never used: the owner can repoint it the next block, so it would describe
 * code that may no longer run.
 *
 * Checking before a call has a gap: the proxy can be upgraded after the check
 * and before the call. So a proxy answer names the implementation and the block
 * it was read at, and a caller can ask again right before sending with
 * `&expectImplementation=0x<that implementation>`. If the proxy points anywhere
 * else by then, the answer is `stale` and not attested: it fails closed. Every
 * proxy asked about is also watched, and an upgrade Monsmith has seen is in the
 * reply, with a link to audit the new code.
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
    // Set when the address asked about is a proxy and the answer is about the
    // code it currently points at, which is what a caller would actually run.
    let implementation: Address | null = null;
    let checkedAtBlock: bigint | null = null;
    let upgrade: ProxyUpgrade | null = null;
    try {
        if (source !== null) {
            if (!/^0x[0-9a-fA-F]{64}$/.test(source)) return reply({ error: "source must be a 32-byte hex hash." }, 400);
            attestation = await attestationOfSource(config, source as Hex);
        } else if (address !== null) {
            if (!isAddress(address) || !Number.isInteger(chainId) || chainId <= 0) {
                return reply({ error: "Give a valid chainId and address." }, 400);
            }
            const code = supportsChain(chainId) ? await deployedCode(chainId, address as Address) : null;
            if (code !== null && code.implementation !== null) {
                implementation = code.implementation;
                checkedAtBlock = code.blockNumber;
                const expected = query.get("expectImplementation");
                // Recorded before answering, so even a stale answer leaves the
                // upgrade on file for the next caller.
                upgrade = await observeProxy(chainId, address, implementation, code.blockNumber).catch((error: unknown) => {
                    console.error("Verify: recording the proxy failed:", error);
                    return null;
                });
                upgrade ??= await lastUpgrade(chainId, address).catch(() => null);
                if (isStale(expected, implementation)) {
                    return reply({ ...staleAnswer(expected ?? "", implementation), checkedAtBlock: code.blockNumber.toString() });
                }
                attestation = await attestationOfDeployment(config, chainId, implementation);
            } else {
                attestation = await attestationOfDeployment(config, chainId, address as Address);
            }
        } else {
            return reply({ error: "Ask about a source hash (?source=) or a deployed contract (?chainId=&address=)." }, 400);
        }
    } catch (error) {
        console.error("Verify: reading Monad failed:", error);
        return reply({ error: "Could not read Monad right now. Try again in a moment." }, 502);
    }

    const agent = { agentId: config.agentId.toString(), registry: AGENT_REGISTRY_ID };
    const proxy =
        implementation === null
            ? {}
            : {
                  proxyOf: implementation,
                  checkedAtBlock: checkedAtBlock?.toString() ?? null,
                  // Hand this back as expectImplementation right before calling.
                  recheck: `/api/verify?chainId=${chainId}&address=${address}&expectImplementation=${implementation}`,
                  ...(upgrade !== null && upgrade.to.toLowerCase() === implementation.toLowerCase()
                      ? {
                            upgradedFrom: upgrade.from,
                            upgradeSeenAt: upgrade.seenAt,
                            auditNewCode: `${siteUrl()}/studio?address=${implementation}&chain=${CHAIN_KEYS[chainId] ?? "monad-mainnet"}`,
                        }
                      : {}),
              };
    if (attestation === null) {
        return reply({ attested: false, agent, contract: config.address, ...proxy });
    }
    return reply({
        attested: true,
        ...proxy,
        agent,
        contract: config.address,
        contractUrl: `${EXPLORER}/address/${config.address}`,
        attestation: { ...attestation, attestedAt: new Date(attestation.timestamp * 1000).toISOString() },
        reportMatches: await reportMatches(attestation),
    });
}
