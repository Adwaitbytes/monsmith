import type { MetadataRoute } from "next";
import { TUTORIALS, absoluteUrl } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/about"), lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: absoluteUrl("/studio"), lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: absoluteUrl("/compare"), lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: absoluteUrl("/tutorials"), lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/stats"), lastModified: now, changeFrequency: "daily", priority: 0.4 },
  ];
  for (const t of TUTORIALS) {
    pages.push({
      url: absoluteUrl(`/tutorials/${t.slug}`),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    });
  }
  return pages;
}
