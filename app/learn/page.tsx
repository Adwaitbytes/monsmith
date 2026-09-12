import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { JsonLd } from "../JsonLd";
import { SiteFooter, SiteNav } from "../SiteChrome";
import { GUIDES, GUIDE_CATEGORIES } from "@/lib/content/guides";
import { FOUNDER, FOUNDER_ID, ORG_ID, absoluteUrl, breadcrumbJsonLd, jsonLdGraph } from "@/lib/seo";

const title = "Smart contract and Monad developer guides";
const description =
  "Free, in-depth guides on Monad, Solidity, smart contract security, gas optimisation, and developer tooling, written by Monsmith founder Adwait Keshari. Deploy on Monad, write parallel-friendly Solidity, compare IDEs, and more.";

export const metadata: Metadata = {
  title: "Learn Smart Contracts & Monad: Developer Guides",
  description,
  keywords: ["smart contract guides", "Monad guides", "Solidity guides", "learn smart contracts", "Monad developer documentation"],
  alternates: { canonical: absoluteUrl("/learn") },
  openGraph: { title, description, url: absoluteUrl("/learn"), type: "website" },
};

export default function LearnIndex() {
  return (
    <main className="min-h-screen bg-background text-text-primary">
      <JsonLd
        data={jsonLdGraph(
          {
            "@type": "CollectionPage",
            "@id": absoluteUrl("/learn"),
            name: title,
            description,
            url: absoluteUrl("/learn"),
            author: { "@id": FOUNDER_ID },
            publisher: { "@id": ORG_ID },
            mainEntity: {
              "@type": "ItemList",
              itemListElement: GUIDES.map((g, i) => ({
                "@type": "ListItem",
                position: i + 1,
                name: g.title,
                url: absoluteUrl(`/learn/${g.slug}`),
              })),
            },
          },
          breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Learn", path: "/learn" }]),
        )}
      />
      <SiteNav />
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">Learn</p>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight sm:text-6xl">{title}</h1>
        <p className="mt-6 max-w-2xl text-lg text-text-secondary">{description}</p>
        <p className="mt-3 text-sm text-text-muted">
          Written by <Link href="/about" className="underline decoration-accent-line underline-offset-4">{FOUNDER.name}</Link>, founder of Monsmith.
        </p>

        {/* The guide is the one thing a new builder should open first, so it
            sits above the article grid rather than inside it. */}
        <a
          href="/guide"
          className="group mt-14 block rounded-2xl border border-accent-line bg-surface-base p-8 transition-all hover:bg-surface-raised sm:p-10"
        >
          <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr] lg:items-center">
            <div>
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">Builder guide</span>
              <h2 className="mt-3 font-display text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
                The complete Monsmith guide for Monad builders
              </h2>
              <p className="mt-4 max-w-xl text-text-secondary">
                A five-minute quickstart to a deployed contract, one page per stage of the workflow with real
                screenshots, an hour-by-hour plan for a Monad Blitz day, a week-by-week plan for a Metropolis
                submission, and the reference tables. Free, no sign-in, kept current with the product.
              </p>
              <ul className="mt-6 flex flex-wrap gap-2">
                {["Quickstart", "The workflow", "Hackathon plans", "Monad in plain language", "Reference"].map((part) => (
                  <li
                    key={part}
                    className="rounded-full border border-border-subtle px-3 py-1 font-mono text-xs text-text-secondary"
                  >
                    {part}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col items-start gap-3 lg:items-end">
              <span className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-medium text-white shadow-[0_8px_30px_-8px] shadow-accent transition-transform group-hover:-translate-y-0.5">
                Open the guide
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </span>
              <span className="text-xs text-text-muted">Opens on Notion. Also at monsmith.com/guide.</span>
            </div>
          </div>
        </a>

        {GUIDE_CATEGORIES.map((cat) => (
          <section key={cat} className="mt-16">
            <h2 className="font-display text-2xl font-semibold tracking-tight">{cat}</h2>
            <ul className="mt-6 grid gap-5 sm:grid-cols-2">
              {GUIDES.filter((g) => g.category === cat).map((g) => (
                <li key={g.slug}>
                  <Link
                    href={`/learn/${g.slug}`}
                    className="group block h-full rounded-2xl border border-border-subtle bg-surface-base p-6 transition-all hover:border-accent-line hover:bg-surface-raised"
                  >
                    <span className="font-mono text-xs uppercase tracking-wide text-accent">{g.level} · {g.readMinutes} min read</span>
                    <h3 className="mt-3 font-display text-xl font-semibold leading-snug tracking-tight">{g.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-text-secondary">{g.description}</p>
                    <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium">
                      Read guide
                      <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>
      <SiteFooter />
    </main>
  );
}
