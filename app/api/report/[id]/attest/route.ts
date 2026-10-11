import { NextResponse } from "next/server";
import type { Address, Hex } from "viem";

import { attestConfig, EXPLORER, writeAttestation } from "@/lib/attest/chain";
import { reportHash } from "@/lib/attest/hash";
import { deployedCode, supportsChain } from "@/lib/attest/rpc";
import { getApiViewer } from "@/lib/auth/server";
import { isReportId } from "@/lib/billing/reportPayments";
import { LIMITS, rateLimit, tooManyRequests } from "@/lib/rateLimit";
import { entitlementFor } from "@/lib/report/entitlement";
import { attestationsFor, loadReport, recordAttestation, type StoredAttestation } from "@/lib/report/store";
import { siteUrl } from "@/lib/siteUrl";

/**
 * Publishing a report onchain.
 *
 * Writes each audited contract's score to the Monsmith attestations contract
 * on Monad mainnet, under Monsmith's ERC-8004 agent identity, so a wallet or
 * an agent about to call that contract can check it without trusting this
 * site. Only someone who can read the full report may publish it, each
 * contract is published once per report, and the source hash comes from the
 * report itself, recorded when the code was audited, never from the request.
 */

export const runtime = "nodejs";
export const maxDuration = 120;

/** Attestations are paid for by Monsmith, so one request publishes a bounded number. */
const MAX_PER_REQUEST = 3;

function shape(entry: StoredAttestation) {
    return { ...entry, explorerUrl: `${EXPLORER}/tx/${entry.txHash}` };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    if (!isReportId(id)) return NextResponse.json({ error: "That is not a report id." }, { status: 400 });
    const config = attestConfig();
    return NextResponse.json({
        enabled: config !== null,
        agentId: config === null ? null : config.agentId.toString(),
        contract: config?.address ?? null,
        attestations: (await attestationsFor(id)).map(shape),
    });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    if (!isReportId(id)) return NextResponse.json({ success: false, error: "That is not a report id." }, { status: 400 });

    const config = attestConfig();
    if (config === null) {
        return NextResponse.json({ success: false, error: "Publishing to Monad is not set up on this deployment." }, { status: 503 });
    }

    const viewer = await getApiViewer();
    const budget = await rateLimit(req, LIMITS.attest, viewer.userId);
    if (!budget.ok) return tooManyRequests(budget, "onchain publications");

    const stored = await loadReport(id).catch((error: unknown) => {
        console.error(`Attest: could not read report ${id}:`, error);
        return null;
    });
    if (stored === null) return NextResponse.json({ success: false, error: "Report not found." }, { status: 404 });

    const { entitled } = await entitlementFor(id, req);
    if (!entitled) {
        return NextResponse.json({ success: false, error: "Unlock the full report before publishing it." }, { status: 402 });
    }

    const report = stored.report;
    const already = await attestationsFor(id);
    const done = new Set(already.map((entry) => entry.contractPath));
    const pending = report.contracts.filter(
        (contract) => contract.sourceHash !== undefined && contract.health !== null && !done.has(contract.path),
    );
    if (pending.length === 0 && already.length === 0) {
        return NextResponse.json(
            { success: false, error: "This report predates onchain publishing. Run it again to publish it." },
            { status: 409 },
        );
    }

    const origin = report.origin;
    let deployment = origin.kind === "address" ? { chainId: origin.chainId, target: origin.address as Address } : null;
    let boundToSource = false;
    if (deployment !== null && supportsChain(deployment.chainId)) {
        const { chainId, target } = deployment;
        try {
            const code = await deployedCode(chainId, target);
            if (!code.hasCode) {
                return NextResponse.json(
                    { success: false, error: "There is no contract at this address any more, so there is nothing to attest it against." },
                    { status: 409 },
                );
            }
            // A proxy can be repointed at other code, so its score is
            // published against the audited source only, never the address.
            if (code.implementation !== null) {
                deployment = null;
                boundToSource = true;
            }
        } catch (error) {
            console.error(`Attest: checking the code at ${target} on chain ${chainId} failed:`, error);
            return NextResponse.json({ success: false, error: "Could not read the deployed contract. Try again in a moment." }, { status: 502 });
        }
    }
    const hash = reportHash(report);
    const uri = `${siteUrl()}/report/${id}`;

    try {
        for (const contract of pending.slice(0, MAX_PER_REQUEST)) {
            const tx = await writeAttestation(config, {
                sourceHash: contract.sourceHash as Hex,
                // A report of a deployed address is about its one contract; the
                // address only identifies that one, never a sibling file.
                chainId: deployment !== null && report.contracts.length === 1 ? deployment.chainId : 0,
                target: deployment !== null && report.contracts.length === 1 ? deployment.target : "0x0000000000000000000000000000000000000000",
                score: contract.health?.score ?? 0,
                critical: contract.counts.critical,
                high: contract.counts.high,
                medium: contract.counts.medium,
                low: contract.counts.low,
                reportHash: hash,
                reportURI: uri,
            });
            await recordAttestation(id, contract.path, contract.sourceHash as string, tx);
        }
    } catch (error) {
        console.error(`Attest: publishing ${id} failed:`, error);
        return NextResponse.json(
            { success: false, error: "Publishing to Monad failed. Nothing was charged to you; try again in a moment." },
            { status: 502 },
        );
    }

    return NextResponse.json({ success: true, boundToSource, attestations: (await attestationsFor(id)).map(shape) });
}
