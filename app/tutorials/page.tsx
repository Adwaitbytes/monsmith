import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { JsonLd } from "../JsonLd";
import { MonsmithMark } from "../landing/MonsmithMark";
import { TUTORIALS, absoluteUrl, breadcrumbJsonLd, jsonLdGraph } from "@/lib/seo";

const title = "Monad smart contract tutorials";
const description =
  "Free, step-by-step Solidity tutorials for Monad: build an ERC20 token, create gaming NFTs, and deploy to Monad testnet from your browser with Monsmith.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: absoluteUrl("/tutorials") },
  openGraph: { title, description, url: absoluteUrl("/tutorials"), type: "website" },
};

export default function TutorialsIndex() {
  return (
    <main className="min-h-screen bg-background text-text-primary">
      <JsonLd
        data={jsonLdGraph(
          {
            "@type": "ItemList",
            name: title,
            itemListElement: TUTORIALS.map((t, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: t.title,
              url: absoluteUrl(`/tutorials/${t.slug}`),
            })),
          },
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Tutorials", path: "/tutorials" },
          ]),
        )}
      />
      <nav className="border-b border-border-subtle px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <MonsmithMark className="h-6 w-6" />
            <span className="font-display text-[15px] font-semibold tracking-tight">Monsmith</span>
          </Link>
          <Link
            href="/studio"
            className="rounded-lg bg-text-primary px-4 py-1.5 text-[13px] font-semibold text-background transition-opacity hover:opacity-90"
          >
            Open studio
          </Link>
        </div>
      </nav>
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">Learn</p>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight sm:text-6xl">{title}</h1>
        <p className="mt-6 max-w-2xl text-lg text-text-secondary">{description}</p>
        <ul className="mt-14 grid gap-6 sm:grid-cols-2">
          {TUTORIALS.map((t) => (
            <li key={t.slug}>
              <Link
                href={`/tutorials/${t.slug}`}
                className="group block h-full rounded-2xl border border-border-subtle bg-surface-base p-7 transition-all hover:border-accent-line hover:bg-surface-raised"
              >
                <span className="font-mono text-xs uppercase tracking-wide text-accent">
                  {t.level} · {t.minutes} min
                </span>
                <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">{t.title}</h2>
                <p className="mt-3 text-sm leading-relaxed text-text-secondary">{t.description}</p>
                <span className="mt-6 inline-flex items-center gap-1 text-sm font-medium">
                  Start tutorial
                  <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
