import type { MetadataRoute } from "next";
import { absoluteUrl, siteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api/", "/embed/", "/share"],
      },
      // Answer engines are welcome; the whole site is meant to be quoted.
      { userAgent: ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "anthropic-ai", "CCBot"], allow: "/" },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: siteUrl(),
  };
}
