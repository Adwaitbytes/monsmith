import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { JsonLd } from "../../JsonLd";
import { inline } from "../../learn/Blocks";
import { SiteFooter, SiteNav } from "../../SiteChrome";
import { GLOSSARY, getTerm } from "@/lib/content/glossary";
import { getGuide } from "@/lib/content/guides";
import { FOUNDER, FOUNDER_ID, ORG_ID, absoluteUrl, breadcrumbJsonLd, jsonLdGraph } from "@/lib/seo";

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return GLOSSARY.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const t = getTerm(slug);
  if (!t) return { title: "Term not found", robots: { index: false } };
  const url = absoluteUrl(`/glossary/${t.slug}`);
  const plain = t.term.replace(/\s*\(.*\)$/, "");
  return {
    title: `What is ${plain}? Definition and example`,
    description: t.short,
    keywords: [`what is ${plain}`, `${plain} definition`, `${plain} meaning`, `${plain} smart contract`, `${plain} Solidity`, `${plain} Monad`],
    alternates: { canonical: url },
    openGraph: { type: "article", title: `What is ${t.term}?`, description: t.short, url },
    twitter: { card: "summary_large_image", title: `What is ${t.term}?`, description: t.short },
  };
}

export default async function TermPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const t = getTerm(slug);
  if (!t) notFound();
  const url = absoluteUrl(`/glossary/${t.slug}`);
  const related = t.related.map(getTerm).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const guides = (t.guides ?? []).map(getGuide).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const plain = t.term.replace(/\s*\(.*\)$/, "");

  return (
    <main className="min-h-screen bg-background text-text-primary">
      <JsonLd
        data={jsonLdGraph(
          {
            "@type": "DefinedTerm",
            "@id": url,
            name: t.term,
            description: t.short,
            url,
            inDefinedTermSet: absoluteUrl("/glossary"),
          },
          {
            "@type": "Article",
            "@id": `${url}#article`,
            headline: `What is ${plain}?`,
            description: t.short,
            articleBody: `${t.short} ${t.long}${t.monsmith ? ` ${t.monsmith}` : ""}`,
            author: { "@id": FOUNDER_ID },
            publisher: { "@id": ORG_ID },
            mainEntityOfPage: url,
            dateModified: "2026-09-10",
            inLanguage: "en",
            speakable: { "@type": "SpeakableSpecification", cssSelector: ["h1", ".term-definition"] },
          },
          {
            "@type": "FAQPage",
            "@id": `${url}#faq`,
            mainEntity: [{ "@type": "Question", name: `What is ${plain}?`, acceptedAnswer: { "@type": "Answer", text: t.short } }],
          },
          breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Glossary", path: "/glossary" }, { name: t.term, path: `/glossary/${t.slug}` }]),
        )}
      />
      <SiteNav />
      <article className="mx-auto max-w-3xl px-6 py-14 sm:py-20">
        <nav aria-label="Breadcrumb" className="font-mono text-xs text-text-muted">
          <ol className="flex flex-wrap items-center gap-2">
            <li><Link href="/" className="hover:text-text-primary">Home</Link></li>
            <li aria-hidden>/</li>
            <li><Link href="/glossary" className="hover:text-text-primary">Glossary</Link></li>
            <li aria-hidden>/</li>
            <li aria-current="page">{plain}</li>
          </ol>
        </nav>
        <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.18em] text-accent">Definition</p>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight sm:text-5xl">What is {t.term}?</h1>
        <p className="term-definition mt-6 text-xl leading-relaxed">{inline(t.short)}</p>
        <p className="mt-5 leading-relaxed text-text-secondary">{inline(t.long)}</p>
        {t.monsmith && (
          <aside className="mt-8 rounded-xl border border-accent-line bg-accent-soft px-5 py-4 text-sm leading-relaxed">
            <span className="font-mono text-[11px] uppercase tracking-wide text-accent">In Monsmith</span>
            <p className="mt-1">{inline(t.monsmith)}</p>
          </aside>
        )}

        {guides.length > 0 && (
          <section className="mt-12">
            <h2 className="font-display text-2xl font-semibold tracking-tight">Go deeper</h2>
            <ul className="mt-4 space-y-3">
              {guides.map((g) => (
                <li key={g.slug}>
                  <Link href={`/learn/${g.slug}`} className="group inline-flex items-center gap-2 text-text-secondary hover:text-text-primary">
                    {g.title}
                    <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {related.length > 0 && (
          <section className="mt-12">
            <h2 className="font-display text-2xl font-semibold tracking-tight">Related terms</h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link href={`/glossary/${r.slug}`} className="rounded-md bg-surface-sunken px-3 py-1.5 text-sm hover:bg-accent-soft">{r.term}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-12 text-sm text-text-muted">
          Definition by <Link href="/adwait-keshari" rel="author" className="underline decoration-accent-line underline-offset-4">{FOUNDER.name}</Link>, founder of Monsmith.
        </p>

        <section className="mt-12 rounded-3xl border border-border-subtle bg-surface-sunken/40 p-8 text-center">
          <h2 className="font-display text-2xl font-semibold tracking-tight">See it in practice</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-text-secondary">Open Monsmith, paste a contract, and watch the audit and profiler explain it.</p>
          <Link href="/studio" className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-medium text-white transition-transform hover:-translate-y-0.5">
            Open the studio <ArrowRight size={16} />
          </Link>
        </section>
      </article>
      <SiteFooter />
    </main>
  );
}
