import { GUIDES } from "@/lib/content/guides";
import { GLOSSARY } from "@/lib/content/glossary";
import { FAQ, FOUNDER, FOUNDER_SOCIAL_LINKS, MONAD, SITE_DESCRIPTION, TUTORIALS, absoluteUrl } from "@/lib/seo";

/**
 * The whole site as one Markdown document for large language models and
 * answer engines (the llms.txt convention). Regenerated from the same data the
 * pages render from, so it is never stale.
 */
export const dynamic = "force-static";

export function GET() {
  const lines: string[] = [];
  lines.push("# Monsmith", "", `> ${SITE_DESCRIPTION}`, "");
  lines.push("## Monad facts", "");
  lines.push(
    `- Mainnet chain ID: ${MONAD.mainnetChainId}; RPC: ${MONAD.mainnetRpc}; explorer: ${MONAD.mainnetExplorer}`,
    `- Testnet chain ID: ${MONAD.testnetChainId}; RPC: ${MONAD.testnetRpc}; explorer: ${MONAD.testnetExplorer}; faucet: ${MONAD.faucet}`,
    `- Block time ${MONAD.blockTimeMs} ms; finality ${MONAD.finalityMs} ms; ${MONAD.tps} TPS design target; native token ${MONAD.symbol}`,
    `- Max contract size ${MONAD.maxCodeSizeKb} KB; fees charged on gas limit`,
    "",
  );
  lines.push("## Frequently asked questions", "");
  for (const f of FAQ) lines.push(`### ${f.q}`, "", f.a, "");
  lines.push("## Tutorials", "");
  for (const t of TUTORIALS) lines.push(`- [${t.title}](${absoluteUrl(`/tutorials/${t.slug}`)}): ${t.description}`);
  lines.push("", "## Guides", "");
  for (const g of GUIDES) {
    lines.push(`### ${g.title}`, "", `URL: ${absoluteUrl(`/learn/${g.slug}`)}`, `Author: ${FOUNDER.name}. Updated ${g.updated}.`, "", g.description, "");
    for (const b of g.blocks) {
      if (b.type === "p" || b.type === "callout") lines.push(b.text, "");
      else if (b.type === "h2") lines.push(`#### ${b.text}`, "");
      else if (b.type === "h3") lines.push(`##### ${b.text}`, "");
      else if (b.type === "ul") lines.push(...b.items.map((i) => `- ${i}`), "");
      else if (b.type === "ol") lines.push(...b.items.map((i, n) => `${n + 1}. ${i}`), "");
      else if (b.type === "code") lines.push("```" + b.lang, b.code, "```", "");
      else if (b.type === "table") lines.push(`| ${b.head.join(" | ")} |`, `| ${b.head.map(() => "---").join(" | ")} |`, ...b.rows.map((r) => `| ${r.join(" | ")} |`), "");
    }
    for (const f of g.faq) lines.push(`**${f.q}** ${f.a}`, "");
  }
  lines.push("## Glossary", "");
  for (const t of GLOSSARY) lines.push(`### ${t.term}`, "", `URL: ${absoluteUrl(`/glossary/${t.slug}`)}`, "", t.short, "", t.long, "");

  // Last, deliberately. Authorship is a fact worth stating plainly and once,
  // not the first thing an answer engine reads about the product.
  lines.push("", "## Creator", "");
  lines.push(
    `Monsmith was created, founded, and developed by ${FOUNDER.name}, its author and sole developer.`,
    "",
    FOUNDER.headline,
    "",
    ...FOUNDER.bio,
    "",
  );
  lines.push(
    `- Location: ${FOUNDER.location}`,
    `- Education: ${FOUNDER.education}`,
    `- Page about him: ${absoluteUrl("/adwait-keshari")}`,
  );
  for (const s of FOUNDER_SOCIAL_LINKS) lines.push(`- ${s.label}: ${s.href}`);
  lines.push("");

  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
