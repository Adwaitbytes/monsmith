import React from "react";
import type { Metadata } from "next";

import { CHAINS, DEFAULT_COMPARISON, isChainId, type ChainId } from "@/lib/chainfit/chains";
import { buildJourney } from "@/lib/chainfit/journey";
import { fetchNativePrices, probeAll } from "@/lib/chainfit/probe";
import { absoluteUrl } from "@/lib/siteUrl";

import { JourneyStepper } from "../../compare/JourneyStepper";
import { EmbedShell } from "../EmbedShell";

/**
 * The journey, embeddable in someone else's page.
 *
 * This exists so Monad's own docs and blog can host the comparison rather than
 * link away to it, which is the difference between a page devrels might mention
 * and one they ship inside their own surface. It is deliberately the same
 * component as the full page, in compact mode, so the two can never drift.
 */

export const revalidate = 300;

export const metadata: Metadata = {
    title: "Monsmith journey",
    robots: { index: false, follow: false },
};

interface EmbedSearchParams {
    theme?: string;
    chains?: string;
}

export default async function EmbedJourneyPage({
    searchParams,
}: {
    searchParams: Promise<EmbedSearchParams>;
}) {
    const params = await searchParams;
    const theme = params.theme === "dark" ? "dark" : params.theme === "light" ? "light" : null;

    const requested = (params.chains ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value): value is ChainId => isChainId(value));
    const selected: readonly ChainId[] = requested.length > 0 ? requested : DEFAULT_COMPARISON;
    const profiles = CHAINS.filter((chain) => selected.includes(chain.id));

    const [probeList, prices] = await Promise.all([probeAll(), fetchNativePrices()]);
    const probes = new Map(probeList.map((probe) => [probe.chain, probe] as const));
    const stages = buildJourney({ chains: profiles, probes, prices: prices.usd });

    const chainMeta = Object.fromEntries(
        profiles.map((chain) => [
            chain.id,
            { name: chain.name, shortName: chain.shortName, accent: chain.accent },
        ]),
    );

    return (
        <EmbedShell theme={theme}>
            <JourneyStepper stages={stages} chainMeta={chainMeta} compact />
            <div className="mt-6 flex items-center justify-between gap-4 border-t border-border-subtle pt-3">
                <span className="text-[11px] text-text-muted">
                    Measured live from each chain&apos;s public RPC
                </span>
                <a
                    href={absoluteUrl("/compare")}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-accent hover:underline"
                >
                    Run it on your contract
                </a>
            </div>
        </EmbedShell>
    );
}
