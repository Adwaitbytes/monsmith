import Link from "next/link";
import type { ReactNode } from "react";

import { MonsmithMark } from "./landing/MonsmithMark";
import { ThemeToggle } from "./ThemeToggle";
import { FOUNDER, FOUNDER_SOCIAL_LINKS, PRODUCT_SOCIALS, SITE_NAME } from "@/lib/seo";

/**
 * Server-rendered navigation and footer for content pages (guides, glossary,
 * about, tutorials). Every link here is crawlable HTML, which is the point:
 * internal links are how a search engine discovers and ranks the long tail.
 */

export const PRIMARY_NAV: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Learn", href: "/learn" },
  { label: "Glossary", href: "/glossary" },
  { label: "Tutorials", href: "/tutorials" },
  { label: "Chain Fit", href: "/compare" },
  { label: "About", href: "/about" },
];

export function SiteNav({ children }: { children?: ReactNode }) {
  return (
    <nav className="border-b border-border-subtle px-6 py-4">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <MonsmithMark className="h-6 w-6" />
          <span className="font-display text-[15px] font-semibold tracking-tight">{SITE_NAME}</span>
        </Link>
        <div className="hidden items-center gap-6 md:flex">
          {PRIMARY_NAV.map((item) => (
            <Link key={item.href} href={item.href} className="text-sm text-text-secondary transition-colors hover:text-text-primary">
              {item.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          {children}
          <Link
            href="/studio"
            className="rounded-lg bg-text-primary px-4 py-1.5 text-[13px] font-semibold text-background transition-opacity hover:opacity-90"
          >
            Open studio
          </Link>
        </div>
      </div>
    </nav>
  );
}

const FOOTER_COLUMNS: ReadonlyArray<{ title: string; links: ReadonlyArray<{ label: string; href: string; external?: boolean }> }> = [
  {
    title: "Product",
    links: [
      { label: "Studio (IDE)", href: "/studio" },
      { label: "Chain Fit gas comparison", href: "/compare" },
      { label: "Live stats", href: "/stats" },
      { label: "Source on GitHub", href: PRODUCT_SOCIALS.github, external: true },
    ],
  },
  {
    title: "Learn",
    links: [
      { label: "Developer guides", href: "/learn" },
      { label: "What is Monad?", href: "/learn/what-is-monad" },
      { label: "Deploy a contract on Monad", href: "/learn/how-to-deploy-a-smart-contract-on-monad" },
      { label: "Best smart contract IDEs", href: "/learn/best-smart-contract-ide" },
      { label: "Smart contract glossary", href: "/glossary" },
      { label: "Tutorials", href: "/tutorials" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About Monsmith", href: "/about" },
      { label: `Founder: ${FOUNDER.name}`, href: "/about#adwait-keshari" },
      { label: "Monad docs", href: "https://docs.monad.xyz", external: true },
    ],
  },
  {
    title: "Follow Adwait",
    links: FOUNDER_SOCIAL_LINKS.map((s) => ({ label: s.label, href: s.href, external: true })),
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border-subtle px-6 py-14">
      <div className="mx-auto grid max-w-6xl gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <MonsmithMark size={22} />
            <span className="font-display font-semibold">{SITE_NAME}</span>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-text-secondary">
            The AI-powered smart contract IDE for Monad. Write, audit, profile, and deploy Solidity in your browser.
          </p>
          <p className="mt-4 text-xs text-text-muted">
            Founded and built by{" "}
            <Link href="/about" className="font-medium text-text-secondary hover:text-text-primary">
              {FOUNDER.name}
            </Link>
            . © 2026 {SITE_NAME}.
          </p>
        </div>
        {FOOTER_COLUMNS.map((col) => (
          <div key={col.title}>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-muted">{col.title}</h2>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.href + l.label}>
                  {l.external ? (
                    <a href={l.href} target="_blank" rel="me noopener" className="text-sm text-text-secondary transition-colors hover:text-text-primary">
                      {l.label}
                    </a>
                  ) : (
                    <Link href={l.href} className="text-sm text-text-secondary transition-colors hover:text-text-primary">
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </footer>
  );
}
