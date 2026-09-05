import { NextResponse } from "next/server";

import { CHAINS } from "@/lib/chainfit/chains";
import { effectiveGasPriceWei, fetchNativePrices, probeAll } from "@/lib/chainfit/probe";

/**
 * Live chain matrix.
 *
 * Everything measurable is measured here rather than recited: block time comes
 * from the gap between two real block timestamps, the block gas limit from a
 * real header, the gas price from the endpoint itself. Protocol constants that
 * cannot be probed carry the link they came from. Each value says which of the
 * two it is, so a reader never has to guess whether a number is current.
 */

export const runtime = "nodejs";
export const revalidate = 60;

export async function GET() {
    const [probes, prices] = await Promise.all([probeAll(), fetchNativePrices()]);
    const byChain = new Map(probes.map((probe) => [probe.chain, probe] as const));

    const rows = CHAINS.map((chain) => {
        const probe = byChain.get(chain.id);
        const priceWei = probe === undefined ? null : effectiveGasPriceWei(probe);
        const nativeUsd =
            chain.coingeckoId === null ? null : (prices.usd[chain.coingeckoId] ?? null);

        // A plain transfer is the one operation that costs the same everywhere,
        // which makes it the honest unit for comparing gas prices across chains.
        const transferGas = 21_000;
        const transferNative =
            priceWei === null ? null : Number((BigInt(transferGas) * priceWei) / 10n ** 9n) / 1e9;

        return {
            id: chain.id,
            name: chain.name,
            shortName: chain.shortName,
            chainId: chain.chainId,
            explorer: chain.explorer,
            currencySymbol: chain.currencySymbol,
            accent: chain.accent,
            executionModel: chain.executionModel,
            gasSchedule: chain.gasSchedule,
            gasCharging: chain.gasCharging,
            settlement: chain.settlement,
            dataFee: chain.dataFee,
            maxCodeSize: chain.maxCodeSize,
            maxInitCodeSize: chain.maxInitCodeSize,
            softFinalityMs: chain.softFinalityMs,
            hardFinalityMs: chain.hardFinalityMs,
            withdrawalWindowMs: chain.withdrawalWindowMs,
            globalMempool: chain.globalMempool,
            blobs: chain.blobs,
            caveats: chain.caveats,
            probe: probe ?? null,
            nativeUsd,
            nativeTransferCost: {
                gas: transferGas,
                native: transferNative,
                usd: transferNative === null || nativeUsd === null ? null : transferNative * nativeUsd,
            },
        };
    });

    return NextResponse.json({
        success: true,
        chains: rows,
        pricesAvailable: prices.available,
        generatedAt: new Date().toISOString(),
    });
}
