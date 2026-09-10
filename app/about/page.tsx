import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { existsSync } from "node:fs";
import path from "node:path";

import { JsonLd } from "../JsonLd";
import { SiteFooter, SiteNav } from "../SiteChrome";
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
const description = `${FOUNDER.name} is the founder of Monsmith, the AI-powered smart contract IDE for Monad. IIT Madras Data Science student, full-stack and blockchain engineer, community builder in Bhopal, India. The story behind Monsmith and where to follow Adwait.`;

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
    "Adwait Keshari IIT Madras",
    "Adwait Keshari Bhopal",
    "Adwait Keshari developer",
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
    images: [{ url: absoluteUrl(FOUNDER.image), width: 460, height: 460, alt: `${FOUNDER.name}, founder of Monsmith` }],
  },
  twitter: {
    card: "summary_large_image",
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
  // A second photo is optional; the page only references it when the file is present.
  const hasPortrait = existsSync(path.join(process.cwd(), "public", FOUNDER.portrait));

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
            dateModified: "2026-09-10",
            speakable: { "@type": "SpeakableSpecification", cssSelector: ["h1", ".founder-headline"] },
            primaryImageOfPage: { "@type": "ImageObject", url: absoluteUrl(FOUNDER.image) },
          },
          founderJsonLd(),
          organizationJsonLd(),
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

        {/* ---------------------------------------------------------- Founder */}
        <section id="adwait-keshari" className="mt-10 grid gap-12 lg:grid-cols-[320px_1fr]">
          <div>
            <figure>
              <Image
                src={FOUNDER.image}
                alt={`${FOUNDER.name}, founder of Monsmith, speaking at a Monad community event`}
                width={460}
                height={460}
                priority
                className="w-full max-w-[320px] rounded-3xl border border-border-subtle object-cover"
              />
              <figcaption className="mt-2 text-xs text-text-muted">Speaking at a Monad community event</figcaption>
            </figure>
            {hasPortrait && (
              <Image
                src={FOUNDER.portrait}
                alt={`${FOUNDER.name}, founder of Monsmith`}
                width={640}
                height={853}
                className="mt-4 w-full max-w-[320px] rounded-3xl border border-border-subtle object-cover"
              />
            )}
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
            <p className="founder-headline mt-8 text-xl leading-relaxed">{FOUNDER.headline}</p>
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
              <div>
                <dt className="font-mono text-xs uppercase tracking-wide text-text-muted">Education</dt>
                <dd className="mt-1 font-medium">{FOUNDER.education}</dd>
              </div>
              <div>
                <dt className="font-mono text-xs uppercase tracking-wide text-text-muted">Community</dt>
                <dd className="mt-1 font-medium">{FOUNDER.communities.join(" · ")}</dd>
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
      <SiteFooter />
    </main>
  );
}
