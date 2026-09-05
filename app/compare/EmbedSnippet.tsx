'use client';

import React, { useMemo, useState } from 'react';

/**
 * The paste-into-your-own-page snippet.
 *
 * The point of the embed is that Monad's docs and blog can host the comparison
 * instead of linking away from it, so the snippet has to be one copy and one
 * paste with no build step and no JavaScript required on their side. The
 * auto-height listener is offered separately because it is an improvement, not
 * a dependency: without it the iframe keeps whatever height the embedder set.
 */

export interface EmbedSnippetProps {
  /** Absolute origin of this deployment, resolved on the server. */
  origin: string;
  chainIds: string[];
}

type ThemeChoice = 'auto' | 'light' | 'dark';

export function EmbedSnippet({ origin, chainIds }: EmbedSnippetProps) {
  const [theme, setTheme] = useState<ThemeChoice>('auto');
  const [selected, setSelected] = useState<string[]>(chainIds);
  const [copied, setCopied] = useState<'iframe' | 'resize' | null>(null);

  const src = useMemo(() => {
    const params = new URLSearchParams();
    if (theme !== 'auto') params.set('theme', theme);
    // Only pin the chain list when it differs, so the default stays current if
    // the comparison set changes later.
    if (selected.length > 0 && selected.length !== chainIds.length) {
      params.set('chains', selected.join(','));
    }
    const query = params.toString();
    return `${origin}/embed/journey${query.length > 0 ? `?${query}` : ''}`;
  }, [origin, theme, selected, chainIds]);

  const iframeCode = `<iframe
  src="${src}"
  title="Monsmith: the EVM development journey, measured"
  width="100%"
  height="620"
  loading="lazy"
  style="border:0;border-radius:16px"
></iframe>`;

  const resizeCode = `<script>
  window.addEventListener("message", function (event) {
    if (event.data && event.data.type === "monsmith:height") {
      var frame = document.querySelector('iframe[src^="${origin}/embed/"]');
      if (frame) frame.style.height = event.data.height + "px";
    }
  });
</script>`;

  const copy = async (text: string, which: 'iframe' | 'resize') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access can be denied; the code stays selectable either way.
      setCopied(null);
    }
  };

  const toggleChain = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  };

  return (
    <div className="rounded-2xl border border-border-subtle p-5 sm:p-6">
      <h3 className="font-display text-xl font-semibold tracking-tight text-text-primary">
        Put this on your own page
      </h3>
      <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-text-secondary">
        The journey above, as an iframe. It reads the same live data, follows your page&apos;s colour
        scheme, and needs no script on your side.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-text-muted">Theme</span>
          {(['auto', 'light', 'dark'] as ThemeChoice[]).map((option) => (
            <button
              key={option}
              onClick={() => setTheme(option)}
              className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                theme === option
                  ? 'border-accent-line bg-accent-soft text-text-primary'
                  : 'border-border-subtle text-text-secondary hover:border-border-strong'
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-text-muted">Chains</span>
          {chainIds.map((id) => (
            <button
              key={id}
              onClick={() => toggleChain(id)}
              aria-pressed={selected.includes(id)}
              className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                selected.includes(id)
                  ? 'border-accent-line bg-accent-soft text-text-primary'
                  : 'border-border-subtle text-text-muted hover:border-border-strong'
              }`}
            >
              {id}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            Paste this
          </span>
          <button
            onClick={() => copy(iframeCode, 'iframe')}
            className="rounded-lg border border-border-subtle px-3 py-1 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
          >
            {copied === 'iframe' ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="mt-2 overflow-x-auto rounded-xl border border-border-subtle bg-surface-sunken p-4 font-mono text-[12px] leading-relaxed text-text-primary">
          <code>{iframeCode}</code>
        </pre>
      </div>

      <details className="mt-4 group">
        <summary className="cursor-pointer text-[12.5px] text-text-secondary transition-colors hover:text-text-primary">
          Optional: let the frame size itself
        </summary>
        <div className="mt-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-text-muted">
              The embed posts its height; this resizes the frame to match.
            </span>
            <button
              onClick={() => copy(resizeCode, 'resize')}
              className="rounded-lg border border-border-subtle px-3 py-1 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
            >
              {copied === 'resize' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="mt-2 overflow-x-auto rounded-xl border border-border-subtle bg-surface-sunken p-4 font-mono text-[12px] leading-relaxed text-text-primary">
            <code>{resizeCode}</code>
          </pre>
        </div>
      </details>

      <p className="mt-4 text-[11.5px] text-text-muted">
        Preview it at{' '}
        <a href={src} target="_blank" rel="noreferrer" className="text-accent hover:underline">
          {src.replace(/^https?:\/\//, '')}
        </a>
      </p>
    </div>
  );
}
