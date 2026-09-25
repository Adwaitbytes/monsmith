import { NextResponse } from "next/server";

import {
    ContractSourceError,
    fetchContractSource,
    NETWORKS,
    type NetworkType,
} from "@/lib/contractSources";
import { getApiViewer } from "@/lib/auth/server";
import { LIMITS, rateLimit, tooManyRequests } from "@/lib/rateLimit";

/**
 * A deployed contract, as files you can audit.
 *
 * The landing page offers to audit an address, and the report engine works on
 * a workspace of files, so something has to turn one into the other. This is
 * that: give it an address, get back the verified source keyed by path, ready
 * to drop into the editor exactly like a GitHub import.
 *
 * Deliberately separate from the migration route, which resolves the same
 * source for a different purpose and returns a rewrite alongside it. A caller
 * that only wants to read a contract should not have to ignore a migration.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
    address?: unknown;
    network?: unknown;
}

function readNetwork(value: unknown): NetworkType {
    if (typeof value === "string" && value in NETWORKS) return value as NetworkType;
    // Ethereum holds the most verified source by a wide margin, so it is the
    // guess that is right most often when the caller does not say.
    return "ethereum";
}

/**
 * How the fetched source becomes a workspace.
 *
 * A verified contract is often many files, and the explorer hands them back as
 * one concatenated blob when it cannot separate them. Keeping the real name
 * matters more than splitting perfectly: the report labels findings by file,
 * and `contract.sol` on every row tells a reader nothing.
 */
function toFiles(name: string, source: string): Record<string, string> {
    const safe = name.replace(/[^A-Za-z0-9_]/g, "") || "Contract";
    return { [`contracts/${safe}.sol`]: source };
}

export async function POST(req: Request) {
    // Metered before any work: this route spends real compute for
    // anyone who asks, and nothing was counting how often.
    const viewer = await getApiViewer();
    const budget = await rateLimit(req, LIMITS.compute, viewer.userId);
    if (!budget.ok) return tooManyRequests(budget, "source lookups");

    let body: Body;
    try {
        body = (await req.json()) as Body;
    } catch {
        return NextResponse.json({ error: "Malformed request." }, { status: 400 });
    }

    const address = typeof body.address === "string" ? body.address.trim() : "";
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return NextResponse.json(
            { error: "That is not a contract address." },
            { status: 400 },
        );
    }

    const network = readNetwork(body.network);

    try {
        const contract = await fetchContractSource(address, network);

        return NextResponse.json({
            files: toFiles(contract.name, contract.sourceCode),
            name: contract.name,
            address: contract.address,
            network,
            chainId: NETWORKS[network].chainId,
            // Worth surfacing: a proxy's own source says nothing about what it
            // actually runs, and a reader who does not know that will trust a
            // clean report on twenty lines of forwarding logic.
            isProxy: contract.isProxy,
            implementationAddress: contract.implementationAddress ?? null,
            sourceProvider: contract.sourceProvider,
            fileCount: contract.fileCount,
        });
    } catch (error) {
        if (error instanceof ContractSourceError) {
            const status =
                error.failure === "invalid-address"
                    ? 400
                    : error.failure === "not-verified"
                      ? 404
                      : error.failure === "unsupported-network"
                        ? 400
                        : 502;
            return NextResponse.json({ error: error.message, failure: error.failure }, { status });
        }

        console.error("Contract source lookup failed:", error);
        return NextResponse.json(
            { error: "Could not reach the explorer just now." },
            { status: 502 },
        );
    }
}
