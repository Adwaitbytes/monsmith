import { GUIDES } from "@/lib/content/guides";
import { FOUNDER, SITE_DESCRIPTION, SITE_NAME, absoluteUrl } from "@/lib/seo";

/** RSS feed of the guides, so aggregators and answer engines discover new content. */
export const dynamic = "force-static";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function GET() {
  const items = GUIDES.slice()
    .sort((a, b) => (a.updated < b.updated ? 1 : -1))
    .map(
      (g) => `    <item>
      <title>${esc(g.title)}</title>
      <link>${absoluteUrl(`/learn/${g.slug}`)}</link>
      <guid isPermaLink="true">${absoluteUrl(`/learn/${g.slug}`)}</guid>
      <description>${esc(g.description)}</description>
      <category>${esc(g.category)}</category>
      <author>${esc(FOUNDER.name)}</author>
      <pubDate>${new Date(g.published).toUTCString()}</pubDate>
    </item>`,
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(SITE_NAME)} · Developer guides</title>
    <link>${absoluteUrl("/learn")}</link>
    <atom:link href="${absoluteUrl("/feed.xml")}" rel="self" type="application/rss+xml" />
    <description>${esc(SITE_DESCRIPTION)}</description>
    <language>en</language>
    <managingEditor>${esc(FOUNDER.name)}</managingEditor>
${items}
  </channel>
</rss>`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
