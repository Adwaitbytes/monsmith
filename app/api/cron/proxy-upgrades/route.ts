import { NextResponse } from "next/server";
import type { Address } from "viem";

import { observeProxy, watchedProxies } from "@/lib/attest/proxyWatch";
import { deployedCode, supportsChain } from "@/lib/attest/rpc";

/**
 * Re-reads every proxy Monsmith has been asked about, on a schedule.
 *
 * The verifier notices an upgrade when someone asks about the proxy. This
 * notices it when nobody does, so the record of what changed and when does
 * not depend on traffic. Reading the implementation slot is one call per proxy
 * and catches every upgrade, where scanning `Upgraded` logs on a chain with
 * sub-second blocks would be thousands of calls for the same answer.
 *
 * Called by Vercel Cron with the project's CRON_SECRET; nothing else may run it.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const BATCH = 200;

export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET ?? "";
    if (secret.length === 0 || request.headers.get("authorization") !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "Not allowed." }, { status: 401 });
    }

    const proxies = await watchedProxies(BATCH);
    let checked = 0;
    let failed = 0;
    const upgrades: Array<{ chainId: number; proxy: string; from: string; to: string }> = [];

    for (const { chainId, proxy } of proxies) {
        if (!supportsChain(chainId)) continue;
        try {
            const code = await deployedCode(chainId, proxy as Address);
            checked += 1;
            if (code.implementation === null) continue;
            const upgrade = await observeProxy(chainId, proxy, code.implementation, code.blockNumber);
            if (upgrade !== null) upgrades.push({ chainId, proxy, from: upgrade.from, to: upgrade.to });
        } catch (error) {
            failed += 1;
            console.error(`[proxy-upgrades] reading ${proxy} on ${chainId} failed:`, error);
        }
    }

    if (upgrades.length > 0) console.warn("[proxy-upgrades] upgrades seen:", JSON.stringify(upgrades));
    return NextResponse.json({ watched: proxies.length, checked, failed, upgrades });
}
