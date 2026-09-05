import React, { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { CHAINS, DEFAULT_COMPARISON } from "@/lib/chainfit/chains";
import { buildJourney, REFERENCE_CALL_GAS } from "@/lib/chainfit/journey";
import { effectiveGasPriceWei, fetchNativePrices, probeAll } from "@/lib/chainfit/probe";
import { absoluteUrl, siteUrl } from "@/lib/siteUrl";

import { MonsmithMark } from "../landing/MonsmithMark";
import { ChainMatrix } from "./ChainMatrix";
import { CompareClient } from "./CompareClient";
import { EmbedSnippet } from "./EmbedSnippet";
import { JourneyStepper } from "./JourneyStepper";
import { VolumeCalculator, type VolumeChain } from "./VolumeCalculator";

const description =
    "Runs your Solidity contract in a real EVM, then reprices that exact execution under each chain's published gas schedule and its live gas price. Measurements, not marketing.";

export const metadata: Metadata = {
    title: "Chain Fit: measure your contract on Monad against every EVM chain",
    description,
    alternates: { canonical: absoluteUrl("/compare") },
    openGraph: {
        title: "Stop comparing chains. Compare your contract.",
        description,
        url: absoluteUrl("/compare"),
        type: "website",
    },
    twitter: { card: "summary_large_image", title: "Chain Fit", description },
};

/** Live probes run per request, cached briefly so a burst of readers is cheap. */
export const revalidate = 60;

const METHOD_STEPS = [
    {
        title: "Compile and run it",
        body: "Your contract is compiled with solc and deployed into a local EVM. Every state-changing function is then called and traced opcode by opcode, so the Ethereum gas figure is what a real EVM charged rather than a static estimate.",
    },
    {
        title: "Reprice the same execution",
        body: "Monad keeps Ethereum's costs everywhere except four places: cold state access, the granularity at which storage warms, four precompiles, and memory expansion. Those four are recomputed against that one trace. Everything the two chains price the same cancels and is never modelled.",
    },
    {
        title: "Price it in money",
        body: "Gas units are converted at the gas price read from each chain's public RPC at page load. Block times come from the gap between two real block timestamps. Numbers that drift are measured; protocol constants carry the link they came from.",
    },
];

export default async function ComparePage() {
    const profiles = CHAINS.filter((chain) => DEFAULT_COMPARISON.includes(chain.id));
    const [probeList, prices] = await Promise.all([probeAll(), fetchNativePrices()]);
    const probes = new Map(probeList.map((probe) => [probe.chain, probe] as const));

    const stages = buildJourney({ chains: profiles, probes, prices: prices.usd });

    const chainMeta = Object.fromEntries(
        profiles.map((chain) => [
            chain.id,
            { name: chain.name, shortName: chain.shortName, accent: chain.accent },
        ]),
    );

    // USD per single unit of gas, so the calculator can multiply rather than
    // re-derive a price the rest of the page already agreed on.
    const volumeChains: VolumeChain[] = profiles.map((chain) => {
        const probe = probes.get(chain.id);
        const priceWei = probe === undefined ? null : effectiveGasPriceWei(probe);
        const nativeUsd =
            chain.coingeckoId === null ? null : (prices.usd[chain.coingeckoId] ?? null);
        const usdPerGas =
            priceWei === null || nativeUsd === null
                ? null
                : (Number(priceWei) / 1e18) * nativeUsd;
        return {
            id: chain.id,
            shortName: chain.shortName,
            accent: chain.accent,
            usdPerGas,
            chargesGasLimit: chain.gasCharging === "gas_limit",
        };
    });

    return (
        <main className="min-h-screen bg-background text-text-primary">
            <nav className="border-b border-border-subtle px-6 py-4">
                <div className="mx-auto flex max-w-6xl items-center justify-between">
                    <Link href="/" className="flex items-center gap-2.5">
                        <MonsmithMark className="h-6 w-6" />
                        <span className="font-display text-[15px] font-semibold tracking-tight">
                            Monsmith
                        </span>
                    </Link>
                    <Link
                        href="/studio"
                        className="rounded-lg bg-text-primary px-4 py-1.5 text-[13px] font-semibold text-background transition-opacity hover:opacity-90"
                    >
                        Open studio
                    </Link>
                </div>
            </nav>

            <section className="px-6 pb-16 pt-20">
                <div className="mx-auto max-w-6xl">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                        Chain Fit
                    </p>
                    <h1 className="mt-5 max-w-3xl font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl md:text-6xl">
                        Stop comparing chains. Compare your contract.
                    </h1>
                    <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-text-secondary">
                        Every chain comparison you have read is a table of numbers about the chain. This
                        one runs your contract, watches what it actually does, and prices that execution
                        under each chain&apos;s real gas schedule. Where Monad costs more, it says so.
                    </p>
                </div>
            </section>

            <section className="border-t border-border-subtle px-6 py-16">
                <div className="mx-auto max-w-6xl">
                    <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                        Seven places you would notice the difference
                    </h2>
                    <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-text-secondary">
                        The development journey, one stage at a time. Each stage has a single parameter
                        that decides something, and the friction it costs you, on every chain including
                        this one.
                    </p>
                    <div className="mt-8">
                        <JourneyStepper stages={stages} chainMeta={chainMeta} />
                    </div>
                </div>
            </section>

            <section className="border-t border-border-subtle bg-surface-sunken/30 px-6 py-16">
                <div className="mx-auto max-w-6xl">
                    <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                        The networks, right now
                    </h2>
                    <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-text-secondary">
                        Read from each chain&apos;s own public RPC when this page was generated. Nothing
                        here is quoted from a blog post.
                    </p>
                    <div className="mt-8">
                        <Suspense
                            fallback={
                                <div className="h-64 animate-pulse rounded-2xl border border-border-subtle bg-surface-sunken/50" />
                            }
                        >
                            <ChainMatrix />
                        </Suspense>
                    </div>
                    <div className="mt-10">
                        <VolumeCalculator chains={volumeChains} defaultGas={REFERENCE_CALL_GAS} />
                    </div>
                </div>
            </section>

            <section className="border-t border-border-subtle px-6 py-16">
                <div className="mx-auto max-w-6xl">
                    <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                        Now do it to a contract
                    </h2>
                    <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-text-secondary">
                        Pick a sample or paste your own. Nothing is stored.
                    </p>
                    <div className="mt-8">
                        <CompareClient />
                    </div>
                </div>
            </section>

            <section className="border-t border-border-subtle bg-surface-sunken/30 px-6 py-16">
                <div className="mx-auto max-w-6xl">
                    <EmbedSnippet origin={siteUrl()} chainIds={profiles.map((chain) => chain.id)} />
                </div>
            </section>

            <section className="border-t border-border-subtle px-6 py-16">
                <div className="mx-auto max-w-6xl">
                    <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                        How the numbers are produced
                    </h2>
                    <div className="mt-8 grid gap-8 md:grid-cols-3">
                        {METHOD_STEPS.map((step, index) => (
                            <div key={step.title}>
                                <span className="font-mono text-[12px] text-text-muted">
                                    {String(index + 1).padStart(2, "0")}
                                </span>
                                <h3 className="mt-2 text-[16px] font-semibold text-text-primary">
                                    {step.title}
                                </h3>
                                <p className="mt-2 text-[13.5px] leading-relaxed text-text-secondary">
                                    {step.body}
                                </p>
                            </div>
                        ))}
                    </div>

                    <div className="mt-10 rounded-2xl border border-border-subtle p-6">
                        <h3 className="text-[15px] font-semibold text-text-primary">
                            What this does not measure
                        </h3>
                        <ul className="mt-3 space-y-2">
                            {[
                                "Rollups charge for publishing calldata to Ethereum on top of execution gas. That component moves with Ethereum's fee market rather than with your contract, and it is not included, so Base, Arbitrum and OP Mainnet are shown cheaper than they are.",
                                "Functions are called with synthesised arguments. One guarded by a balance or permission check reverts, and a reverted call is marked rather than folded into a total.",
                                "Gas units are not money, and money is not the whole decision. Ecosystem depth, liquidity and the maturity of the tooling around a chain are real and are not on this page.",
                            ].map((line) => (
                                <li
                                    key={line}
                                    className="relative pl-4 text-[13.5px] leading-relaxed text-text-secondary"
                                >
                                    <span className="absolute left-0 top-2.5 h-1 w-1 rounded-full bg-text-muted" />
                                    {line}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </section>

            <footer className="border-t border-border-subtle px-6 py-10">
                <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 text-[13px] text-text-muted">
                    <span>Monsmith</span>
                    <div className="flex flex-wrap items-center gap-5">
                        <Link href="/studio" className="transition-colors hover:text-text-primary">
                            Studio
                        </Link>
                        <a
                            href="https://docs.monad.xyz/developer-essentials/opcode-pricing"
                            target="_blank"
                            rel="noreferrer"
                            className="transition-colors hover:text-text-primary"
                        >
                            Monad gas schedule
                        </a>
                        <a href="/api/chains" className="transition-colors hover:text-text-primary">
                            Matrix as JSON
                        </a>
                        <a href="/embed/journey" className="transition-colors hover:text-text-primary">
                            Embed
                        </a>
                    </div>
                </div>
            </footer>
        </main>
    );
}
