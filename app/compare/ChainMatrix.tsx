import React from "react";

import { CHAINS } from "@/lib/chainfit/chains";
import { effectiveGasPriceWei, fetchNativePrices, probeAll } from "@/lib/chainfit/probe";

/**
 * The live parameter matrix.
 *
 * Every cell is one of two things and says which: a number measured from the
 * chain's own RPC seconds ago, or a protocol constant with the link it came
 * from. Nothing is recited from memory, and nothing is left blank when a probe
 * fails, because a table with holes in it is what makes readers stop trusting
 * the rest of the page.
 */

function durationText(ms: number): string {
    if (ms < 1_000) return `${ms} ms`;
    if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
    if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h`;
    return `${Math.round(ms / 86_400_000)} d`;
}

function gweiText(wei: bigint | null): string {
    if (wei === null) return "-";
    const gwei = Number(wei) / 1e9;
    if (gwei === 0) return "0";
    if (gwei < 0.001) return gwei.toExponential(1);
    if (gwei < 1) return gwei.toFixed(4);
    return gwei.toFixed(2);
}

function usdText(value: number | null): string {
    if (value === null) return "-";
    if (value < 0.000001) return "<$0.000001";
    if (value < 0.01) return `$${value.toFixed(6)}`;
    return `$${value.toFixed(4)}`;
}

function Basis({ basis }: { basis: "measured" | "documented" }) {
    const measured = basis === "measured";
    return (
        <span
            title={
                measured
                    ? "Measured from the chain's public RPC when this page was generated"
                    : "From documentation; the live probe did not answer"
            }
            className={`ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${
                measured ? "bg-emerald-500" : "bg-amber-500"
            }`}
        />
    );
}

function Cell({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
    return (
        <td
            className={`whitespace-nowrap border-b border-border-subtle px-3 py-2.5 text-right text-[13px] text-text-secondary ${
                mono ? "font-mono tabular-nums" : ""
            }`}
        >
            {children}
        </td>
    );
}

export async function ChainMatrix() {
    const [probes, prices] = await Promise.all([probeAll(), fetchNativePrices()]);
    const byChain = new Map(probes.map((probe) => [probe.chain, probe] as const));
    const generatedAt = new Date();

    const rows = CHAINS.map((chain) => {
        const probe = byChain.get(chain.id) ?? null;
        const priceWei = probe === null ? null : effectiveGasPriceWei(probe);
        const nativeUsd =
            chain.coingeckoId === null ? null : (prices.usd[chain.coingeckoId] ?? null);
        // A native transfer is the one operation that costs the same everywhere,
        // which makes it the only fair way to compare gas prices across chains.
        const transferNative =
            priceWei === null ? null : Number((21_000n * priceWei) / 10n ** 9n) / 1e9;
        return { chain, probe, priceWei, nativeUsd, transferNative };
    });

    return (
        <div>
            <div className="overflow-x-auto rounded-2xl border border-border-subtle">
                <table className="w-full min-w-[860px] border-collapse">
                    <thead>
                        <tr className="bg-surface-sunken/60">
                            <th className="border-b border-border-strong px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                                Chain
                            </th>
                            {[
                                "Block time",
                                "Finality",
                                "Max contract",
                                "Gas price",
                                "21k transfer",
                                "Execution",
                                "Charges for",
                            ].map((label) => (
                                <th
                                    key={label}
                                    className="whitespace-nowrap border-b border-border-strong px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-text-muted"
                                >
                                    {label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(({ chain, probe, priceWei, nativeUsd, transferNative }) => {
                            const isHome = chain.id === "monad";
                            const blockTime = probe?.blockTimeMs ?? null;
                            return (
                                <tr key={chain.id} className={isHome ? "bg-accent-soft" : undefined}>
                                    <th
                                        scope="row"
                                        className="border-b border-border-subtle px-3 py-2.5 text-left"
                                    >
                                        <span className="flex items-center gap-2">
                                            <span
                                                className="h-2 w-2 shrink-0 rounded-full"
                                                style={{ background: chain.accent }}
                                            />
                                            <span
                                                className={`text-[13px] ${
                                                    isHome
                                                        ? "font-semibold text-text-primary"
                                                        : "text-text-primary"
                                                }`}
                                            >
                                                {chain.name}
                                            </span>
                                            <span className="font-mono text-[11px] text-text-muted">
                                                {chain.chainId}
                                            </span>
                                        </span>
                                    </th>
                                    <Cell mono>
                                        {blockTime === null ? "-" : durationText(blockTime.value)}
                                        {blockTime !== null && <Basis basis={blockTime.basis} />}
                                    </Cell>
                                    <Cell mono>
                                        {durationText(chain.hardFinalityMs.value)}
                                        {chain.withdrawalWindowMs !== null && (
                                            <span className="ml-1 text-[11px] text-text-muted">
                                                (+{durationText(chain.withdrawalWindowMs.value)} to exit)
                                            </span>
                                        )}
                                    </Cell>
                                    <Cell mono>{Math.round(chain.maxCodeSize.value / 1024)} KB</Cell>
                                    <Cell mono>{gweiText(priceWei)} gwei</Cell>
                                    <Cell mono>
                                        {usdText(
                                            transferNative === null || nativeUsd === null
                                                ? null
                                                : transferNative * nativeUsd,
                                        )}
                                    </Cell>
                                    <Cell>
                                        {chain.executionModel === "optimistic-parallel"
                                            ? "parallel"
                                            : "sequential"}
                                    </Cell>
                                    <Cell mono>
                                        {chain.gasCharging === "gas_limit" ? "gas limit" : "gas used"}
                                    </Cell>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-text-muted">
                <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    measured from the chain just now
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    from documentation, probe did not answer
                </span>
                <span>
                    Generated{" "}
                    {generatedAt.toLocaleString("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "UTC",
                    })}{" "}
                    UTC
                </span>
            </div>

            <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-text-secondary">
                Finality is the point past which the result cannot be reversed without trusting an
                operator. For the optimistic rollups that is Ethereum, not the sequencer, and moving
                funds back out waits on the challenge window shown in brackets. A sequencer
                confirmation arrives in well under a second on all three; it is a promise rather than
                settlement, and which of the two your product needs depends on what the user is
                allowed to do next.
            </p>
        </div>
    );
}
