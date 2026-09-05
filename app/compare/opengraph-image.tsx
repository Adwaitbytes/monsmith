import { ImageResponse } from "next/og";

import { CHAINS } from "@/lib/chainfit/chains";
import { effectiveGasPriceWei, fetchNativePrices, probeAll } from "@/lib/chainfit/probe";

/**
 * Share card for /compare.
 *
 * It carries live numbers rather than a slogan, because the thing worth sharing
 * is that the figures are current. If a probe fails the row is simply left out;
 * a card with a blank cell would undercut the one claim the page makes.
 */

export const runtime = "nodejs";
export const alt = "The EVM development journey, measured live across six chains";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BACKGROUND = "#0a0a0f";
const TEXT = "#f5f5fa";
const MUTED = "#7e7e92";

function usdText(value: number): string {
    if (value < 0.000001) return "<$0.000001";
    if (value < 0.01) return `$${value.toFixed(6)}`;
    return `$${value.toFixed(4)}`;
}

export default async function Image() {
    const [probes, prices] = await Promise.all([probeAll(), fetchNativePrices()]);
    const byChain = new Map(probes.map((probe) => [probe.chain, probe] as const));

    const rows = CHAINS.map((chain) => {
        const probe = byChain.get(chain.id);
        const priceWei = probe === undefined ? null : effectiveGasPriceWei(probe);
        const nativeUsd =
            chain.coingeckoId === null ? null : (prices.usd[chain.coingeckoId] ?? null);
        if (priceWei === null || nativeUsd === null) return null;
        const native = Number((21_000n * priceWei) / 10n ** 9n) / 1e9;
        return {
            name: chain.shortName,
            accent: chain.accent,
            blockTime: probe?.blockTimeMs?.value ?? null,
            transfer: native * nativeUsd,
        };
    }).filter((row): row is NonNullable<typeof row> => row !== null);

    return new ImageResponse(
        (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    background: BACKGROUND,
                    padding: "64px 72px",
                    fontFamily: "sans-serif",
                }}
            >
                <div style={{ display: "flex", color: MUTED, fontSize: 22, letterSpacing: 3 }}>
                    MONSMITH · CHAIN FIT
                </div>

                <div
                    style={{
                        display: "flex",
                        color: TEXT,
                        fontSize: 62,
                        fontWeight: 700,
                        lineHeight: 1.1,
                        marginTop: 20,
                        maxWidth: 900,
                    }}
                >
                    Stop comparing chains. Compare your contract.
                </div>

                <div style={{ display: "flex", flexDirection: "column", marginTop: 44, gap: 14 }}>
                    {rows.slice(0, 6).map((row) => (
                        <div
                            key={row.name}
                            style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 26 }}
                        >
                            <div
                                style={{
                                    width: 12,
                                    height: 12,
                                    borderRadius: 6,
                                    background: row.accent,
                                    display: "flex",
                                }}
                            />
                            <div style={{ display: "flex", color: TEXT, width: 200 }}>{row.name}</div>
                            <div style={{ display: "flex", color: MUTED, width: 180 }}>
                                {row.blockTime === null
                                    ? "-"
                                    : row.blockTime < 1000
                                      ? `${row.blockTime} ms blocks`
                                      : `${(row.blockTime / 1000).toFixed(1)} s blocks`}
                            </div>
                            <div style={{ display: "flex", color: MUTED }}>
                                {usdText(row.transfer)} per transfer
                            </div>
                        </div>
                    ))}
                </div>

                <div
                    style={{
                        display: "flex",
                        color: MUTED,
                        fontSize: 20,
                        marginTop: "auto",
                    }}
                >
                    Measured from each chain&apos;s public RPC, {new Date().toISOString().slice(0, 10)}
                </div>
            </div>
        ),
        size,
    );
}
