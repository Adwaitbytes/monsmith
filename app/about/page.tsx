import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { JsonLd } from "../JsonLd";
import { SiteFooter, SiteNav } from "../SiteChrome";
import {
  FOUNDER,
  SITE_NAME,
  absoluteUrl,
  breadcrumbJsonLd,
  founderJsonLd,
  jsonLdGraph,
  organizationJsonLd,
  softwareJsonLd,
} from "@/lib/seo";

/**
 * The page about the product.
 *
 * It used to open with the founder's name as its h1, which made the whole site
 * read as a personal project and put an identity page in front of anyone
 * searching for the tool. The person now has his own page; this one answers
 * "what is Monsmith and why does it exist", and credits him at the end where a
 * reader who has finished the story is the one who cares.
 */

const title = `About ${SITE_NAME}`;
const description = `${SITE_NAME} is the free, AI-powered smart contract IDE for Monad: write, compile, audit, profile for parallel execution, and deploy Solidity in the browser. Why it exists, what it does differently, and who built it.`;

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "about Monsmith",
    "what is Monsmith",
    "Monsmith IDE",
    "Monad smart contract IDE",
    "smart contract IDE for Monad",
    "Monsmith founder",
    "who created Monsmith",
  ],
  alternates: { canonical: absoluteUrl("/about") },
  openGraph: {
    type: "website",
    title,
    description,
    url: absoluteUrl("/about"),
  },
  twitter: { card: "summary_large_image", title, description },
};

const MILESTONES = [
  {
    when: "The problem",
    what: "Building for a parallel EVM meant a local toolchain, a mental model nobody had written down, and chain comparisons based on marketing pages.",
  },
  {
    when: "The bet",
    what: "One browser tab should carry the whole loop: write, compile, audit, profile for parallelism, deploy, migrate. No setup, no guesswork.",
  },
  {
    when: "The product",
    what: "Monsmith shipped with a Monaco editor, an AI-assisted auditor, the Monad parallel profiler, Chain Fit live gas comparison, and one-click testnet deploys.",
  },
  {
    when: "The measure",
    what: "Every number the studio prints is measured, not modelled from a datasheet: contracts are executed in a real EVM and repriced under each chain's published gas schedule.",
  },
];

const PRINCIPLES = [
  {
    title: "Measured, not claimed",
    body: "Chain Fit runs your contract and reprices that exact execution under each chain's gas rules at the current gas price. When a number cannot be measured honestly, the studio says so instead of printing one.",
  },
  {
    title: "Built for one chain, properly",
    body: "Monad's parallel execution changes how storage layout affects throughput. The profiler reads the dependencies between your functions and says which ones can actually run at the same time.",
  },
  {
    title: "Nothing to install",
    body: "Every compiler version from 0.4 upward runs in the browser session, imports resolve, and deployment is one wallet confirmation. Contracts stay plain Solidity, so nothing locks you in.",
  },
];

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-background text-text-primary">
      <JsonLd
        data={jsonLdGraph(
          {
            "@type": "AboutPage",
            "@id": absoluteUrl("/about"),
            url: absoluteUrl("/about"),
            name: title,
            description,
            isPartOf: { "@id": `${absoluteUrl("/")}#website` },
            dateModified: "2026-09-11",
            speakable: { "@type": "SpeakableSpecification", cssSelector: ["h1", ".about-lede"] },
          },
          softwareJsonLd(),
          organizationJsonLd(),
          // The Person stays in the graph even though the page leads with the
          // product: this is the page an engine lands on for "about Monsmith",
          // and the founder edge is how it answers "who made it" from here.
          founderJsonLd(),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "About", path: "/about" },
          ]),
        )}
      />

      <SiteNav />

      <article className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <nav aria-label="Breadcrumb" className="font-mono text-xs text-text-muted">
          <ol className="flex items-center gap-2">
            <li><Link href="/" className="hover:text-text-primary">Home</Link></li>
            <li aria-hidden>/</li>
            <li aria-current="page">About</li>
          </ol>
        </nav>

        {/* ---------------------------------------------------------- Product */}
        <header className="mt-10 max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">About</p>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight sm:text-6xl">
            {SITE_NAME}
          </h1>
          <p className="about-lede mt-8 text-xl leading-relaxed text-text-secondary">
            {SITE_NAME} is a browser-based studio for building smart contracts on Monad. Write,
            compile against any Solidity version, audit, profile for parallel execution, compare the
            cost across EVM chains, and deploy, without installing a toolchain.
          </p>
        </header>

        {/* ------------------------------------------------------------ Story */}
        <section className="mt-20 border-t border-border-subtle pt-16">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">The story</p>
          <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Why {SITE_NAME} exists
          </h2>
          <p className="mt-6 max-w-3xl leading-relaxed text-text-secondary">
            Shipping a contract to Monad should not require installing a toolchain,
            reverse-engineering how parallel execution treats your storage, and choosing a chain
            from a comparison table that somebody else wrote. {SITE_NAME} is the tool that answers
            those three questions in one place, from measurements rather than marketing.
          </p>
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border-subtle bg-border-subtle sm:grid-cols-2 lg:grid-cols-4">
            {MILESTONES.map((m) => (
              <div key={m.when} className="bg-surface-base p-6">
                <span className="font-mono text-xs uppercase tracking-wide text-accent">{m.when}</span>
                <p className="mt-3 text-sm leading-relaxed text-text-secondary">{m.what}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------- Principles */}
        <section className="mt-24 border-t border-border-subtle pt-16">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">How it is built</p>
          <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            What {SITE_NAME} does differently
          </h2>
          <div className="mt-12 grid gap-10 sm:grid-cols-3">
            {PRINCIPLES.map((p) => (
              <div key={p.title}>
                <h3 className="font-display text-lg font-semibold tracking-tight">{p.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-text-secondary">{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------- Creator */}
        {/*
          Last, and small. The question "who made this" deserves a real answer
          and a real page; it does not deserve the top of the page about the
          product.
        */}
        <section className="mt-24 border-t border-border-subtle pt-16">
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            Who built {SITE_NAME}
          </h2>
          <p className="mt-4 max-w-3xl leading-relaxed text-text-secondary">
            {SITE_NAME} was created and is developed by{" "}
            <Link
              href="/adwait-keshari"
              className="font-medium text-text-primary underline decoration-accent-line underline-offset-4 hover:decoration-accent"
            >
              {FOUNDER.name}
            </Link>
            , a full-stack and blockchain engineer.
          </p>
          <Link
            href="/adwait-keshari"
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            More about {FOUNDER.name}
            <ArrowRight size={14} />
          </Link>
        </section>

        {/* -------------------------------------------------------------- CTA */}
        <section className="mt-24 rounded-3xl border border-border-subtle bg-surface-sunken/40 p-10 text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight">
            Open the studio
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-text-secondary">
            Paste a contract and see how it runs on Monad. Free, in the browser, no account
            required.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/studio"
              className="rounded-full bg-accent px-7 py-3 text-base font-medium text-white transition-transform hover:-translate-y-0.5"
            >
              Open {SITE_NAME}
            </Link>
            <Link
              href="/learn"
              className="rounded-full border border-border-strong px-7 py-3 text-base font-medium transition-colors hover:bg-surface-raised"
            >
              Read the guides
            </Link>
          </div>
        </section>
      </article>
      <SiteFooter />
    </main>
  );
}
