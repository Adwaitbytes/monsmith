import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { JsonLd } from "../../JsonLd";
import { SiteFooter, SiteNav } from "../../SiteChrome";
import { Blocks, slugify } from "../Blocks";
import { GUIDES, getGuide } from "@/lib/content/guides";
import { getTerm } from "@/lib/content/glossary";
import { FOUNDER, FOUNDER_ID, ORG_ID, absoluteUrl, breadcrumbJsonLd, faqJsonLd, jsonLdGraph } from "@/lib/seo";

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const g = getGuide(slug);
  if (!g) return { title: "Guide not found", robots: { index: false } };
  const url = absoluteUrl(`/learn/${g.slug}`);
  return {
    title: g.seoTitle ?? g.title,
    description: g.description,
    keywords: g.keywords,
    alternates: { canonical: url },
    authors: [{ name: FOUNDER.name, url: absoluteUrl("/adwait-keshari") }],
    openGraph: {
      type: "article",
      title: g.title,
      description: g.description,
      url,
      publishedTime: g.published,
      modifiedTime: g.updated,
      authors: [absoluteUrl("/adwait-keshari")],
      section: g.category,
      tags: g.keywords,
    },
    twitter: { card: "summary_large_image", title: g.seoTitle ?? g.title, description: g.description, creator: FOUNDER.socials.twitterHandle },
  };
}

export default async function GuidePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const g = getGuide(slug);
  if (!g) notFound();

  const url = absoluteUrl(`/learn/${g.slug}`);
  const headings = g.blocks.filter((b) => b.type === "h2").map((b) => (b as { text: string }).text);
  const related = g.related.map(getGuide).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const terms = g.terms.map(getTerm).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const wordCount = g.blocks.reduce((n, b) => {
    const text = "text" in b ? b.text : "items" in b ? b.items.join(" ") : "code" in b ? b.code : b.rows.flat().join(" ");
    return n + text.split(/\s+/).length;
  }, 0);

  const article = {
    "@type": ["TechArticle", "Article"],
    "@id": url,
    headline: g.title,
    alternativeHeadline: g.seoTitle,
    description: g.description,
    keywords: g.keywords.join(", "),
    articleSection: g.category,
    proficiencyLevel: g.level,
    wordCount,
    timeRequired: `PT${g.readMinutes}M`,
    datePublished: g.published,
    dateModified: g.updated,
    inLanguage: "en",
    isAccessibleForFree: true,
    author: { "@id": FOUNDER_ID },
    publisher: { "@id": ORG_ID },
    mainEntityOfPage: url,
    image: absoluteUrl(`/learn/${g.slug}/opengraph-image`),
    about: terms.map((t) => ({ "@type": "DefinedTerm", name: t.term, url: absoluteUrl(`/glossary/${t.slug}`) })),
    speakable: { "@type": "SpeakableSpecification", cssSelector: ["h1", ".guide-summary"] },
  };

  const howTo = g.howTo
    ? {
        "@type": "HowTo",
        name: g.howTo.name,
        description: g.description,
        totalTime: `PT${g.readMinutes}M`,
        tool: [{ "@type": "HowToTool", name: "Monsmith" }, { "@type": "HowToTool", name: "MetaMask or another browser wallet" }],
        step: g.howTo.steps.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s.name, text: s.text, url: `${url}#step-${i + 1}` })),
      }
    : null;

  return (
    <main className="min-h-screen bg-background text-text-primary">
      <JsonLd
        data={jsonLdGraph(
          article,
          ...(howTo ? [howTo] : []),
          faqJsonLd(g.faq, `${url}#faq`),
          breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Learn", path: "/learn" }, { name: g.title, path: `/learn/${g.slug}` }]),
        )}
      />
      <SiteNav />
      <article className="mx-auto max-w-6xl px-6 py-14 sm:py-20">
        <nav aria-label="Breadcrumb" className="font-mono text-xs text-text-muted">
          <ol className="flex flex-wrap items-center gap-2">
            <li><Link href="/" className="hover:text-text-primary">Home</Link></li>
            <li aria-hidden>/</li>
            <li><Link href="/learn" className="hover:text-text-primary">Learn</Link></li>
            <li aria-hidden>/</li>
            <li aria-current="page">{g.category}</li>
          </ol>
        </nav>

        <div className="mt-8 grid gap-12 lg:grid-cols-[1fr_260px]">
          <div className="min-w-0 max-w-3xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">{g.category} · {g.level}</p>
            <h1 className="mt-4 font-display text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">{g.title}</h1>
            <p className="guide-summary mt-6 text-lg leading-relaxed text-text-secondary">{g.description}</p>
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-muted">
              <span>
                By{" "}
                <Link href="/adwait-keshari" rel="author" className="font-medium text-text-secondary hover:text-text-primary">{FOUNDER.name}</Link>
                , founder of Monsmith
              </span>
              <span aria-hidden>·</span>
              <time dateTime={g.updated}>Updated {new Date(g.updated).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</time>
              <span aria-hidden>·</span>
              <span>{g.readMinutes} min read</span>
            </div>

            <Blocks blocks={g.blocks} />

            {g.howTo && (
              <section className="mt-12">
                <h2 id="steps" className="font-display text-2xl font-semibold tracking-tight">Quick steps</h2>
                <ol className="mt-5 space-y-4">
                  {g.howTo.steps.map((s, i) => (
                    <li key={s.name} id={`step-${i + 1}`} className="flex gap-4">
                      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent font-mono text-xs text-white">{i + 1}</span>
                      <div>
                        <h3 className="font-semibold">{s.name}</h3>
                        <p className="mt-1 text-sm leading-relaxed text-text-secondary">{s.text}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <section id="faq" className="mt-14 border-t border-border-subtle pt-10">
              <h2 className="font-display text-2xl font-semibold tracking-tight">Frequently asked questions</h2>
              <dl className="mt-6 space-y-6">
                {g.faq.map((f) => (
                  <div key={f.q}>
                    <dt className="font-semibold">{f.q}</dt>
                    <dd className="mt-1.5 leading-relaxed text-text-secondary">{f.a}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="mt-14 rounded-3xl border border-border-subtle bg-surface-sunken/40 p-8 text-center">
              <h2 className="font-display text-2xl font-semibold tracking-tight">Try it in Monsmith</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-text-secondary">Free, in the browser, no account. Compile, audit, profile, and deploy to Monad.</p>
              <Link href="/studio" className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-medium text-white transition-transform hover:-translate-y-0.5">
                Open the studio <ArrowRight size={16} />
              </Link>
            </section>
          </div>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            {headings.length > 0 && (
              <nav aria-label="On this page">
                <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-muted">On this page</h2>
                <ul className="mt-3 space-y-2 border-l border-border-subtle pl-4 text-sm">
                  {headings.map((h) => (
                    <li key={h}><a href={`#${slugify(h)}`} className="text-text-secondary hover:text-text-primary">{h}</a></li>
                  ))}
                </ul>
              </nav>
            )}
            {terms.length > 0 && (
              <div className="mt-10">
                <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-muted">Terms in this guide</h2>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {terms.map((t) => (
                    <li key={t.slug}>
                      <Link href={`/glossary/${t.slug}`} className="rounded-md bg-surface-sunken px-2 py-1 text-xs hover:bg-accent-soft">{t.term}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {related.length > 0 && (
              <div className="mt-10">
                <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-muted">Related guides</h2>
                <ul className="mt-3 space-y-3 text-sm">
                  {related.map((r) => (
                    <li key={r.slug}><Link href={`/learn/${r.slug}`} className="text-text-secondary hover:text-text-primary">{r.title}</Link></li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </article>
      <SiteFooter />
    </main>
  );
}
