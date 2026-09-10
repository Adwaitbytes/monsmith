import Link from "next/link";
import type { ReactNode } from "react";

import type { Block } from "@/lib/content/guides";

/**
 * Renders guide blocks to real HTML on the server. Inline markup is limited to
 * `code`, **bold**, and [links](/path); everything is emitted as React nodes,
 * never as raw HTML, so content can never become live markup.
 */
export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(<code key={k++} className="rounded bg-accent-soft px-1 py-0.5 font-mono text-[0.9em] text-accent-strong">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**")) {
      out.push(<strong key={k++} className="font-semibold text-text-primary">{tok.slice(2, -2)}</strong>);
    } else {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!;
      const href = mm[2];
      out.push(
        href.startsWith("/") ? (
          <Link key={k++} href={href} className="underline decoration-accent-line underline-offset-4 hover:decoration-accent">{mm[1]}</Link>
        ) : (
          <a key={k++} href={href} target="_blank" rel="noopener" className="underline decoration-accent-line underline-offset-4 hover:decoration-accent">{mm[1]}</a>
        ),
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "p":
            return <p key={i} className="mt-5 leading-relaxed text-text-secondary">{inline(b.text)}</p>;
          case "h2":
            return <h2 key={i} id={slugify(b.text)} className="mt-12 scroll-mt-24 font-display text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl">{b.text}</h2>;
          case "h3":
            return <h3 key={i} id={slugify(b.text)} className="mt-8 scroll-mt-24 font-display text-xl font-semibold text-text-primary">{b.text}</h3>;
          case "ul":
            return (
              <ul key={i} className="mt-5 list-disc space-y-2 pl-6 text-text-secondary marker:text-accent">
                {b.items.map((it, j) => <li key={j} className="leading-relaxed">{inline(it)}</li>)}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="mt-5 list-decimal space-y-2 pl-6 text-text-secondary marker:font-mono marker:text-accent">
                {b.items.map((it, j) => <li key={j} className="leading-relaxed">{inline(it)}</li>)}
              </ol>
            );
          case "code":
            return (
              <pre key={i} className="panel-sunken relative mt-6 overflow-x-auto rounded-xl border border-border-subtle p-4">
                <span className="absolute right-3 top-2 font-mono text-[10px] uppercase tracking-wider text-text-muted">{b.lang}</span>
                <code className="font-mono text-[13px] leading-relaxed text-text-primary">{b.code}</code>
              </pre>
            );
          case "callout":
            return (
              <aside key={i} className="mt-6 rounded-xl border border-accent-line bg-accent-soft px-5 py-4 text-sm leading-relaxed text-text-primary">
                {inline(b.text)}
              </aside>
            );
          case "table":
            return (
              <div key={i} className="mt-6 overflow-x-auto rounded-xl border border-border-subtle">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-sunken font-mono text-[11px] uppercase tracking-wide text-text-muted">
                    <tr>{b.head.map((h, j) => <th key={j} className="px-4 py-3 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j} className="border-t border-border-subtle">
                        {r.map((c, k) => <td key={k} className={`px-4 py-3 align-top ${k === 0 ? "font-medium text-text-primary" : "text-text-secondary"}`}>{c}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </>
  );
}
