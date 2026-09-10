import type { MetadataRoute } from "next";
import { GUIDES } from "@/lib/content/guides";
import { GLOSSARY } from "@/lib/content/glossary";
import { TUTORIALS, absoluteUrl } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/about"), lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: absoluteUrl("/studio"), lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: absoluteUrl("/compare"), lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: absoluteUrl("/learn"), lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: absoluteUrl("/glossary"), lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/tutorials"), lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/stats"), lastModified: now, changeFrequency: "daily", priority: 0.3 },
  ];
  for (const t of TUTORIALS) {
    pages.push({ url: absoluteUrl(`/tutorials/${t.slug}`), lastModified: now, changeFrequency: "monthly", priority: 0.7 });
  }
  for (const g of GUIDES) {
    pages.push({ url: absoluteUrl(`/learn/${g.slug}`), lastModified: new Date(g.updated), changeFrequency: "monthly", priority: 0.8 });
  }
  for (const t of GLOSSARY) {
    pages.push({ url: absoluteUrl(`/glossary/${t.slug}`), lastModified: now, changeFrequency: "yearly", priority: 0.6 });
  }
  return pages;
}
