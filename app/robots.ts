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
      //
      // Two kinds are listed. GPTBot, ClaudeBot and CCBot crawl for training
      // and indexing; OAI-SearchBot, ChatGPT-User and PerplexityBot fetch a
      // page live while answering someone's question. The second kind is what
      // decides whether Monsmith can be cited in an answer today, so blocking
      // them by omission would be the expensive mistake.
      {
        userAgent: [
          "GPTBot",
          "OAI-SearchBot",
          "ChatGPT-User",
          "ClaudeBot",
          "Claude-User",
          "Claude-SearchBot",
          "anthropic-ai",
          "PerplexityBot",
          "Perplexity-User",
          "Google-Extended",
          "Applebot-Extended",
          "CCBot",
          "cohere-ai",
          "Meta-ExternalAgent",
        ],
        allow: "/",
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: siteUrl(),
  };
}
