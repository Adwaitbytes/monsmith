import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd } from "../JsonLd";
import { inline } from "../learn/Blocks";
import { SiteFooter, SiteNav } from "../SiteChrome";
import { GLOSSARY, GLOSSARY_BY_LETTER } from "@/lib/content/glossary";
import { FOUNDER, FOUNDER_ID, ORG_ID, absoluteUrl, breadcrumbJsonLd, jsonLdGraph } from "@/lib/seo";

const title = "Smart contract glossary: every term explained";
const description = `Plain-English definitions of ${GLOSSARY.length} smart contract, Solidity, EVM, and Monad terms, from ABI and gas to reentrancy and parallel execution. Each term links to a guide and to the Monsmith IDE where you can see it in practice.`;

export const metadata: Metadata = {
  title: "Smart Contract Glossary: Solidity, EVM & Monad Terms",
  description,
  keywords: ["smart contract glossary", "Solidity glossary", "blockchain terms", "EVM glossary", "Monad terms", "Web3 glossary"],
  alternates: { canonical: absoluteUrl("/glossary") },
  openGraph: { title, description, url: absoluteUrl("/glossary"), type: "website" },
};

export default async function GlossaryIndex({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim().toLowerCase();
  const letters = Object.keys(GLOSSARY_BY_LETTER).sort();
  const filtered = query ? GLOSSARY.filter((t) => `${t.term} ${t.short}`.toLowerCase().includes(query)) : null;

  return (
    <main className="min-h-screen bg-background text-text-primary">
      <JsonLd
        data={jsonLdGraph(
          {
            "@type": "DefinedTermSet",
            "@id": absoluteUrl("/glossary"),
            name: title,
            description,
            url: absoluteUrl("/glossary"),
            author: { "@id": FOUNDER_ID },
            publisher: { "@id": ORG_ID },
            hasDefinedTerm: GLOSSARY.map((t) => ({
              "@type": "DefinedTerm",
              "@id": absoluteUrl(`/glossary/${t.slug}`),
              name: t.term,
              description: t.short,
              url: absoluteUrl(`/glossary/${t.slug}`),
              inDefinedTermSet: absoluteUrl("/glossary"),
            })),
          },
          breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Glossary", path: "/glossary" }]),
        )}
      />
      <SiteNav />
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">Glossary</p>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight sm:text-6xl">{title}</h1>
        <p className="mt-6 max-w-2xl text-lg text-text-secondary">{description}</p>
        <p className="mt-3 text-sm text-text-muted">
          Maintained by <Link href="/about" className="underline decoration-accent-line underline-offset-4">{FOUNDER.name}</Link>.
        </p>

        <form action="/glossary" method="get" className="mt-10 flex max-w-md gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search terms, e.g. reentrancy"
            aria-label="Search glossary"
            className="w-full rounded-full border border-border-subtle bg-surface-base px-5 py-2.5 text-sm outline-none focus:border-accent-line"
          />
          <button type="submit" className="rounded-full bg-text-primary px-5 py-2.5 text-sm font-semibold text-background">Search</button>
        </form>

        {filtered ? (
          <section className="mt-12">
            <h2 className="font-display text-2xl font-semibold">{filtered.length} result{filtered.length === 1 ? "" : "s"} for “{q}”</h2>
            <TermList terms={filtered} />
          </section>
        ) : (
          <>
            <nav aria-label="Jump to letter" className="mt-10 flex flex-wrap gap-2 font-mono text-sm">
              {letters.map((l) => (
                <a key={l} href={`#${l}`} className="grid h-8 w-8 place-items-center rounded-md border border-border-subtle hover:bg-accent-soft">{l}</a>
              ))}
            </nav>
            {letters.map((l) => (
              <section key={l} id={l} className="mt-14 scroll-mt-24">
                <h2 className="font-display text-3xl font-semibold text-accent">{l}</h2>
                <TermList terms={GLOSSARY_BY_LETTER[l]} />
              </section>
            ))}
          </>
        )}
      </section>
      <SiteFooter />
    </main>
  );
}

function TermList({ terms }: { terms: typeof GLOSSARY }) {
  return (
    <dl className="mt-6 grid gap-5 sm:grid-cols-2">
      {terms.map((t) => (
        <div key={t.slug} className="rounded-2xl border border-border-subtle bg-surface-base p-5">
          <dt>
            <Link href={`/glossary/${t.slug}`} className="font-display text-lg font-semibold hover:text-accent">{t.term}</Link>
          </dt>
          <dd className="mt-2 text-sm leading-relaxed text-text-secondary">{inline(t.short)}</dd>
        </div>
      ))}
    </dl>
  );
}
