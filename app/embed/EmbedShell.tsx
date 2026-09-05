'use client';

import React, { useEffect, useRef } from 'react';

/**
 * Wrapper for anything served under /embed.
 *
 * Two jobs, both of which only matter inside someone else's page.
 *
 * Theme: the root layout picks a theme from localStorage, which a third-party
 * iframe often cannot read at all. So the embed follows the host's colour
 * scheme by default and accepts an explicit override, and it re-applies on
 * change rather than only at mount.
 *
 * Height: an iframe cannot size itself, so the embed measures its own content
 * and posts the height to the parent. An embedder who ignores the message just
 * gets the fixed height they set, which is why the snippet works without any
 * JavaScript on their side.
 */

export interface EmbedShellProps {
  children: React.ReactNode;
  /** 'light' | 'dark' to force, or null to follow the host. */
  theme: 'light' | 'dark' | null;
}

export function EmbedShell({ children, theme }: EmbedShellProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;

    if (theme !== null) {
      root.dataset.theme = theme;
      root.style.colorScheme = theme;
      return;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const next = media.matches ? 'dark' : 'light';
      root.dataset.theme = next;
      root.style.colorScheme = next;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    const node = ref.current;
    if (node === null || typeof ResizeObserver === 'undefined') return;

    let last = 0;
    const post = () => {
      const height = Math.ceil(node.getBoundingClientRect().height);
      // A pixel of jitter would otherwise spam the parent on every reflow.
      if (Math.abs(height - last) < 2) return;
      last = height;
      window.parent?.postMessage({ type: 'monsmith:height', height }, '*');
    };

    const observer = new ResizeObserver(post);
    observer.observe(node);
    post();
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="bg-background px-5 py-5 text-text-primary">
      {children}
    </div>
  );
}
