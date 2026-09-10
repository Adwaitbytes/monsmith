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

/**
 * The page about the person, kept apart from the page about the product.
 *
 * "Who created Monsmith" and "what is Monsmith" are different questions, and a
 * single page that answers both answers neither well: the product page ends up
 * leading with a face, and the identity query lands on a page whose h1 is a
 * product name. Splitting them lets the product read as a product while this
 * page carries the Person schema, the photo, and every profile that verifies
 * the same human, which is what an engine follows to answer the question.
 *
 * It is reached from the footer and one credit line, never from the hero.
 */

const title = `${FOUNDER.name} — Creator of Monsmith`;
const description = `${FOUNDER.name} is the creator, founder, and developer of Monsmith, the AI-powered smart contract IDE for Monad. Full-stack and blockchain engineer, IIT Madras Data Science student, and community builder in India.`;

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    FOUNDER.name,
    `${FOUNDER.name} founder`,
    `${FOUNDER.name} Monsmith`,
    `who created Monsmith`,
    "Monsmith founder",
    "Monsmith creator",
    "Monsmith developer",
    "Adwaitbytes",
    "Adwait Keshari IIT Madras",
    "Adwait Keshari Bhopal",
    "Adwait Keshari developer",
    "Monad developer",
  ],
  alternates: { canonical: absoluteUrl("/adwait-keshari") },
  openGraph: {
    type: "profile",
    title,
    description,
    url: absoluteUrl("/adwait-keshari"),
    firstName: FOUNDER.givenName,
    lastName: FOUNDER.familyName,
    username: FOUNDER.handle,
    images: [
      {
        url: absoluteUrl(FOUNDER.image),
        width: 460,
        height: 460,
        alt: `${FOUNDER.name}, creator of Monsmith`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    creator: FOUNDER.socials.twitterHandle,
  },
};

export default function CreatorPage() {
  // A second photo is optional; the page only references it when the file is present.
  const hasPortrait = existsSync(path.join(process.cwd(), "public", FOUNDER.portrait));

  return (
    <main className="min-h-screen bg-background text-text-primary">
      <JsonLd
        data={jsonLdGraph(
          {
            "@type": "ProfilePage",
            "@id": absoluteUrl("/adwait-keshari"),
            url: absoluteUrl("/adwait-keshari"),
            name: title,
            description,
            mainEntity: { "@id": FOUNDER_ID },
            about: { "@id": FOUNDER_ID },
            isPartOf: { "@id": `${absoluteUrl("/")}#website` },
            dateModified: "2026-09-11",
            speakable: {
              "@type": "SpeakableSpecification",
              cssSelector: ["h1", ".founder-headline"],
            },
            primaryImageOfPage: { "@type": "ImageObject", url: absoluteUrl(FOUNDER.image) },
          },
          founderJsonLd(),
          organizationJsonLd(),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "About", path: "/about" },
            { name: FOUNDER.name, path: "/adwait-keshari" },
          ]),
        )}
      />

      <SiteNav />

      <article className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <nav aria-label="Breadcrumb" className="font-mono text-xs text-text-muted">
          <ol className="flex items-center gap-2">
            <li><Link href="/" className="hover:text-text-primary">Home</Link></li>
            <li aria-hidden>/</li>
            <li><Link href="/about" className="hover:text-text-primary">About</Link></li>
            <li aria-hidden>/</li>
            <li aria-current="page">{FOUNDER.name}</li>
          </ol>
        </nav>

        <section id="adwait-keshari" className="mt-10 grid gap-12 lg:grid-cols-[320px_1fr]">
          <div>
            <figure>
              <Image
                src={FOUNDER.image}
                alt={`${FOUNDER.name}, creator of Monsmith, speaking at a Monad community event`}
                width={460}
                height={460}
                priority
                className="w-full max-w-[320px] rounded-3xl border border-border-subtle object-cover"
              />
              <figcaption className="mt-2 text-xs text-text-muted">
                Speaking at a Monad community event
              </figcaption>
            </figure>
            {hasPortrait && (
              <Image
                src={FOUNDER.portrait}
                alt={`${FOUNDER.name}, creator of Monsmith`}
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
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
              Creator of {SITE_NAME}
            </p>
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
                  <Link
                    href="/about"
                    className="underline decoration-accent-line underline-offset-4 hover:decoration-accent"
                  >
                    {SITE_NAME}, the smart contract IDE for Monad
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

        <section className="mt-24 rounded-3xl border border-border-subtle bg-surface-sunken/40 p-10 text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight">
            Try what he built
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-text-secondary">
            Open the studio, paste a contract, and see how it runs on Monad. Free, in the browser,
            no account required.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/studio"
              className="rounded-full bg-accent px-7 py-3 text-base font-medium text-white transition-transform hover:-translate-y-0.5"
            >
              Open {SITE_NAME}
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
