import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { JsonLd } from "../../JsonLd";
import { FOUNDER, FOUNDER_ID, ORG_ID, TUTORIALS, absoluteUrl, breadcrumbJsonLd, jsonLdGraph } from "@/lib/seo";
import { TutorialClient } from "./TutorialClient";

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return TUTORIALS.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const tutorial = TUTORIALS.find((t) => t.slug === slug);
  if (!tutorial) return { title: "Tutorial not found", robots: { index: false } };
  const url = absoluteUrl(`/tutorials/${tutorial.slug}`);
  return {
    title: tutorial.title,
    description: tutorial.description,
    alternates: { canonical: url },
    openGraph: { type: "article", title: tutorial.title, description: tutorial.description, url, authors: [FOUNDER.name] },
    twitter: { card: "summary_large_image", title: tutorial.title, description: tutorial.description },
  };
}

export default async function TutorialPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const tutorial = TUTORIALS.find((t) => t.slug === slug);
  if (!tutorial) notFound();

  // Rendered on the server so crawlers index the full tutorial text rather
  // than a loading spinner.
  const content = await readFile(path.join(process.cwd(), "tutorials", `${tutorial.slug}.md`), "utf8");

  return (
    <>
      <JsonLd
        data={jsonLdGraph(
          {
            "@type": ["TechArticle", "HowTo"],
            "@id": absoluteUrl(`/tutorials/${tutorial.slug}`),
            headline: tutorial.title,
            description: tutorial.description,
            proficiencyLevel: tutorial.level,
            totalTime: `PT${tutorial.minutes}M`,
            inLanguage: "en",
            author: { "@id": FOUNDER_ID },
            publisher: { "@id": ORG_ID },
            mainEntityOfPage: absoluteUrl(`/tutorials/${tutorial.slug}`),
            about: ["Monad", "Solidity", "Smart contracts"],
          },
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Tutorials", path: "/tutorials" },
            { name: tutorial.title, path: `/tutorials/${tutorial.slug}` },
          ]),
        )}
      />
      <TutorialClient content={content} />
    </>
  );
}
