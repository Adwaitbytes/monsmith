import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";

import { ThemeToggle } from "../ThemeToggle";
import { JsonLd } from "../JsonLd";
import { MonsmithMark } from "../landing/MonsmithMark";
import {
  FOUNDER,
  FOUNDER_ID,
  FOUNDER_SOCIAL_LINKS,
  SITE_NAME,
  absoluteUrl,
  breadcrumbJsonLd,
  founderJsonLd,
  jsonLdGraph,
  organizationJsonLd,
} from "@/lib/seo";

const title = `About Monsmith and founder ${FOUNDER.name}`;
const description = `${FOUNDER.name} is the founder of Monsmith, the AI-powered smart contract IDE for Monad. Learn the story behind the product, what it does, and how to follow Adwait on LinkedIn, X, GitHub, and YouTube.`;

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    FOUNDER.name,
    `${FOUNDER.name} founder`,
    `${FOUNDER.name} Monsmith`,
    "Monsmith founder",
    "who founded Monsmith",
    "Adwaitbytes",
    "Monad developer",
    "smart contract IDE founder",
  ],
  alternates: { canonical: absoluteUrl("/about") },
  openGraph: {
    type: "profile",
    title,
    description,
    url: absoluteUrl("/about"),
    firstName: FOUNDER.givenName,
    lastName: FOUNDER.familyName,
    username: "AdwaitKeshari",
    images: [{ url: absoluteUrl(FOUNDER.image), width: 512, height: 512, alt: FOUNDER.name }],
  },
  twitter: {
    card: "summary",
    title,
    description,
    creator: FOUNDER.socials.twitterHandle,
  },
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
    when: "In the open",
    what: "The code is public on GitHub and the roadmap is shaped by the developers using it. Every feature is built and documented in public.",
  },
];

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-background text-text-primary">
      <JsonLd
        data={jsonLdGraph(
          {
            "@type": "ProfilePage",
            "@id": absoluteUrl("/about"),
            url: absoluteUrl("/about"),
            name: title,
            description,
            mainEntity: { "@id": FOUNDER_ID },
            about: { "@id": FOUNDER_ID },
            isPartOf: { "@id": `${absoluteUrl("/")}#website` },
          },
          founderJsonLd(),
          organizationJsonLd(),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "About", path: "/about" },
          ]),
        )}
      />

      <nav className="border-b border-border-subtle px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <MonsmithMark className="h-6 w-6" />
            <span className="font-display text-[15px] font-semibold tracking-tight">{SITE_NAME}</span>
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/studio"
              className="rounded-lg bg-text-primary px-4 py-1.5 text-[13px] font-semibold text-background transition-opacity hover:opacity-90"
            >
              Open studio
            </Link>
          </div>
        </div>
      </nav>

      <article className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <nav aria-label="Breadcrumb" className="font-mono text-xs text-text-muted">
          <ol className="flex items-center gap-2">
            <li><Link href="/" className="hover:text-text-primary">Home</Link></li>
            <li aria-hidden>/</li>
            <li aria-current="page">About</li>
          </ol>
        </nav>

        {/* ---------------------------------------------------------- Founder */}
        <section id="adwait-keshari" className="mt-10 grid gap-12 lg:grid-cols-[320px_1fr]">
          <div>
            <Image
              src={FOUNDER.image}
              alt={`${FOUNDER.name}, founder of Monsmith`}
              width={320}
              height={320}
              priority
              className="w-full max-w-[320px] rounded-3xl border border-border-subtle"
            />
            <ul className="mt-6 flex flex-wrap gap-2">
              {FOUNDER_SOCIAL_LINKS.map((s) => (
                <li key={s.href}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="me noopener"
                    className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-3 py-1.5 text-xs font-medium transition-colors hover:border-accent-line hover:bg-accent-soft"
                  >
                    {s.label}
                    <ArrowUpRight size={12} />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">Founder</p>
            <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight sm:text-6xl">
              {FOUNDER.name}
            </h1>
            <p className="mt-2 text-lg text-text-secondary">{FOUNDER.title} · {FOUNDER.role}</p>
            <p className="mt-8 text-xl leading-relaxed">{FOUNDER.headline}</p>
            {FOUNDER.bio.map((paragraph) => (
              <p key={paragraph.slice(0, 32)} className="mt-5 leading-relaxed text-text-secondary">
                {paragraph}
              </p>
            ))}

            <dl className="mt-10 grid gap-6 sm:grid-cols-2">
              <div>
                <dt className="font-mono text-xs uppercase tracking-wide text-text-muted">Builds</dt>
                <dd className="mt-1 font-medium">
                  <Link href="/" className="underline decoration-accent-line underline-offset-4 hover:decoration-accent">
                    Monsmith, the smart contract IDE for Monad
                  </Link>
                </dd>
              </div>
              <div>
                <dt className="font-mono text-xs uppercase tracking-wide text-text-muted">Based in</dt>
                <dd className="mt-1 font-medium">{FOUNDER.location}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-mono text-xs uppercase tracking-wide text-text-muted">Expertise</dt>
                <dd className="mt-2 flex flex-wrap gap-2">
                  {FOUNDER.knowsAbout.map((k) => (
                    <span key={k} className="rounded-md bg-surface-sunken px-2 py-1 text-xs">{k}</span>
                  ))}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* ------------------------------------------------------------ Story */}
        <section className="mt-24 border-t border-border-subtle pt-16">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">The story</p>
          <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Why {SITE_NAME} exists
          </h2>
          <p className="mt-6 max-w-3xl leading-relaxed text-text-secondary">
            Monsmith started from a simple frustration: shipping a contract to Monad should not require
            installing a toolchain, reverse-engineering how parallel execution treats your storage, and
            choosing a chain from a comparison table that someone else wrote. {FOUNDER.name} built the
            tool he wanted to use, then put it on the web for everyone.
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

        {/* -------------------------------------------------------------- CTA */}
        <section className="mt-24 rounded-3xl border border-border-subtle bg-surface-sunken/40 p-10 text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight">Try what Adwait built</h2>
          <p className="mx-auto mt-3 max-w-xl text-text-secondary">
            Open the studio, paste a contract, and see how it runs on Monad. Free, in the browser, no account required.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/studio"
              className="rounded-full bg-accent px-7 py-3 text-base font-medium text-white transition-transform hover:-translate-y-0.5"
            >
              Open Monsmith
            </Link>
            <a
              href={FOUNDER.socials.twitter}
              target="_blank"
              rel="me noopener"
              className="rounded-full border border-border-strong px-7 py-3 text-base font-medium transition-colors hover:bg-surface-raised"
            >
              Follow {FOUNDER.socials.twitterHandle}
            </a>
          </div>
        </section>
      </article>
    </main>
  );
}
