/**
 * Single source of truth for everything a search engine or answer engine
 * reads about Monsmith: the product, the company behind it, and its founder.
 *
 * Every page metadata block, JSON-LD graph, sitemap entry, and social link on
 * the site pulls from here so a change in one place (a new handle, a new
 * tagline) propagates everywhere a crawler could see it.
 */

import { absoluteUrl, siteUrl } from "./siteUrl";

export const SITE_NAME = "Monsmith";
export const SITE_TAGLINE = "Build. Learn. Ship to Monad.";
export const SITE_TITLE = "Monsmith · AI-Powered Smart Contract IDE for Monad";
export const SITE_DESCRIPTION =
  "Monsmith is the browser-based, AI-powered smart contract IDE for Monad. Write, compile, audit, profile for parallel execution, deploy, and migrate Solidity contracts without local setup. Founded by Adwait Keshari.";

export const SITE_KEYWORDS = [
  "Monsmith",
  "Monsmith IDE",
  "monsmith.com",
  "Monad",
  "Monad IDE",
  "Monad smart contracts",
  "Monad developer tools",
  "smart contract IDE",
  "AI smart contract IDE",
  "browser Solidity IDE",
  "Solidity",
  "parallel EVM",
  "parallel execution profiler",
  "Chain Fit",
  "EVM gas comparison",
  "Web3 development",
  "smart contract deployment",
  "Adwait Keshari",
  "Adwait Keshari founder",
];

/** The person behind the product. */
export const FOUNDER = {
  name: "Adwait Keshari",
  givenName: "Adwait",
  familyName: "Keshari",
  role: "Founder & Builder",
  title: "Founder of Monsmith",
  headline:
    "Adwait Keshari is the founder of Monsmith, the AI-powered smart contract IDE for Monad. A full-stack and blockchain engineer, he builds developer tools that make shipping to parallel EVM chains fast, safe, and measurable.",
  bio: [
    "Adwait Keshari is a software engineer and founder focused on developer tooling for the next generation of blockchains. He created Monsmith to remove the friction between an idea and a verified contract running on Monad: no local toolchain, no guesswork about parallel execution, and no chain choice made on marketing instead of measurement.",
    "Before Monsmith he shipped full-stack products across Web3 and AI, and he documents the journey of building in public across YouTube, X, LinkedIn, and GitHub. His work spans Solidity, the EVM, Next.js, and applied AI for code analysis.",
    "He believes the best developer tools disappear into the workflow, and Monsmith is built on that conviction: an editor, an auditor, a profiler, and a deploy console that live in one view and answer the question every builder actually has, which is whether the code is ready to ship.",
  ],
  location: "India",
  email: undefined as string | undefined,
  image: "/founder-adwait-keshari.svg",
  socials: {
    linkedin: "https://www.linkedin.com/in/adwait-keshari-b5793b294/",
    twitter: "https://x.com/AdwaitKeshari",
    twitterHandle: "@AdwaitKeshari",
    github: "https://github.com/Adwaitbytes",
    portfolio: "https://adwait-portfolio-blond.vercel.app/",
    youtube: "https://www.youtube.com/@Iitmbs2024",
    instagram: "https://www.instagram.com/adwaitkeshari",
    tiktok: "https://www.tiktok.com/@adwait503",
  },
  knowsAbout: [
    "Smart contracts",
    "Solidity",
    "Monad",
    "Parallel EVM",
    "Ethereum Virtual Machine",
    "Web3 developer tools",
    "Next.js",
    "TypeScript",
    "Applied AI for code analysis",
    "Blockchain engineering",
  ],
} as const;

export const FOUNDER_SOCIAL_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "LinkedIn", href: FOUNDER.socials.linkedin },
  { label: "X (Twitter)", href: FOUNDER.socials.twitter },
  { label: "GitHub", href: FOUNDER.socials.github },
  { label: "Portfolio", href: FOUNDER.socials.portfolio },
  { label: "YouTube", href: FOUNDER.socials.youtube },
  { label: "Instagram", href: FOUNDER.socials.instagram },
  { label: "TikTok", href: FOUNDER.socials.tiktok },
];

export const PRODUCT_SOCIALS = {
  github: "https://github.com/Adwaitbytes/monsmith",
  twitter: FOUNDER.socials.twitter,
};

/** The canonical public origin. Search engines should see exactly one host. */
export const CANONICAL_ORIGIN = "https://www.monsmith.com";

export const FOUNDING_DATE = "2025";

/**
 * Questions people ask search and answer engines about Monsmith, with
 * self-contained answers. Rendered visibly on the landing page and emitted as
 * FAQPage JSON-LD so an engine can quote them directly.
 */
export const FAQ: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: "What is Monsmith?",
    a: "Monsmith is a browser-based, AI-powered IDE for building smart contracts on Monad. It lets you write, compile, audit, profile for parallel execution, deploy, and migrate Solidity contracts without installing anything locally.",
  },
  {
    q: "Who founded Monsmith?",
    a: "Monsmith was founded and built by Adwait Keshari, a full-stack and blockchain engineer who builds developer tools in public. You can follow his work on GitHub (Adwaitbytes), X (@AdwaitKeshari), LinkedIn, and YouTube.",
  },
  {
    q: "Is Monsmith free to use?",
    a: "Yes. You can open the studio at monsmith.com and start building for free without creating an account. Signing in adds capability such as saved projects, but it is never the price of entry.",
  },
  {
    q: "What is Monad and why does Monsmith target it?",
    a: "Monad is a high-performance, EVM-compatible Layer 1 blockchain with parallel transaction execution. Monsmith is built around that architecture: its parallel profiler shows which functions can run concurrently and how to restructure storage so contracts get the full throughput benefit.",
  },
  {
    q: "What does the Monsmith parallel profiler do?",
    a: "It analyses storage dependencies between your contract's functions, scores how parallelisable each one is, draws the dependency graph, and gives specific recommendations for improving throughput on Monad.",
  },
  {
    q: "What is Chain Fit?",
    a: "Chain Fit runs your Solidity contract in a real EVM, then reprices that exact execution under each chain's published gas schedule and live gas price, so you can compare Monad with other EVM chains using measurements rather than marketing.",
  },
  {
    q: "Do I need MetaMask or a wallet to use Monsmith?",
    a: "You can write, compile, audit, and profile contracts with no wallet at all. A wallet such as MetaMask connected to Monad testnet is only needed when you deploy.",
  },
  {
    q: "Is Monsmith open source?",
    a: "Yes. The source code is published on GitHub under the Adwaitbytes account, and the roadmap is built in the open with the developers who use it.",
  },
];

export const TUTORIALS: ReadonlyArray<{
  slug: string;
  title: string;
  description: string;
  level: string;
  minutes: number;
}> = [
  {
    slug: "erc20-token",
    title: "Build and deploy your first ERC20 token on Monad",
    description:
      "A step-by-step Monsmith tutorial: write an ERC20 token in Solidity, compile it in the browser, and deploy it to Monad testnet with security best practices.",
    level: "Beginner",
    minutes: 15,
  },
  {
    slug: "gaming-nft",
    title: "Create gaming NFTs on Monad with ERC721",
    description:
      "Build an ERC721 gaming NFT collection in Monsmith, understand why Monad's parallel execution suits games, and deploy it to Monad testnet.",
    level: "Intermediate",
    minutes: 25,
  },
];

/* ------------------------------------------------------------------ JSON-LD */

export const ORG_ID = `${CANONICAL_ORIGIN}/#organization`;
export const SITE_ID = `${CANONICAL_ORIGIN}/#website`;
export const APP_ID = `${CANONICAL_ORIGIN}/#software`;
export const FOUNDER_ID = `${CANONICAL_ORIGIN}/about#adwait-keshari`;

export function founderJsonLd() {
  return {
    "@type": "Person",
    "@id": FOUNDER_ID,
    name: FOUNDER.name,
    givenName: FOUNDER.givenName,
    familyName: FOUNDER.familyName,
    jobTitle: FOUNDER.title,
    description: FOUNDER.headline,
    url: absoluteUrl("/about"),
    image: absoluteUrl(FOUNDER.image),
    nationality: { "@type": "Country", name: FOUNDER.location },
    worksFor: { "@id": ORG_ID },
    affiliation: { "@id": ORG_ID },
    knowsAbout: [...FOUNDER.knowsAbout],
    sameAs: FOUNDER_SOCIAL_LINKS.map((s) => s.href),
  };
}

export function organizationJsonLd() {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE_NAME,
    legalName: SITE_NAME,
    url: CANONICAL_ORIGIN,
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl("/monsmith-logo.svg"),
    },
    description: SITE_DESCRIPTION,
    slogan: SITE_TAGLINE,
    foundingDate: FOUNDING_DATE,
    founder: { "@id": FOUNDER_ID },
    employee: { "@id": FOUNDER_ID },
    sameAs: [PRODUCT_SOCIALS.github, PRODUCT_SOCIALS.twitter],
  };
}

export function websiteJsonLd() {
  return {
    "@type": "WebSite",
    "@id": SITE_ID,
    name: SITE_NAME,
    alternateName: ["Monsmith IDE", "Monsmith for Monad", "monsmith.com"],
    url: CANONICAL_ORIGIN,
    description: SITE_DESCRIPTION,
    publisher: { "@id": ORG_ID },
    inLanguage: "en",
  };
}

export function softwareJsonLd() {
  return {
    "@type": "SoftwareApplication",
    "@id": APP_ID,
    name: SITE_NAME,
    alternateName: "Monsmith IDE",
    url: CANONICAL_ORIGIN,
    description: SITE_DESCRIPTION,
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "Smart contract IDE",
    operatingSystem: "Web browser",
    browserRequirements: "Requires a modern web browser with JavaScript enabled",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    author: { "@id": FOUNDER_ID },
    creator: { "@id": FOUNDER_ID },
    publisher: { "@id": ORG_ID },
    featureList: [
      "Monaco-based Solidity editor with autocomplete",
      "In-browser compilation with OpenZeppelin support",
      "AI-assisted security auditing",
      "Monad parallel execution profiler",
      "Chain Fit: live gas comparison across EVM chains",
      "One-click deployment to Monad testnet",
      "Guided contract migration",
    ],
    screenshot: absoluteUrl("/monsmith-demo-poster.jpg"),
    softwareHelp: { "@type": "CreativeWork", url: absoluteUrl("/tutorials") },
  };
}

export function faqJsonLd() {
  return {
    "@type": "FAQPage",
    "@id": `${CANONICAL_ORIGIN}/#faq`,
    mainEntity: FAQ.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}

export function breadcrumbJsonLd(items: ReadonlyArray<{ name: string; path: string }>) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

/** Wraps any set of nodes into one JSON-LD graph document. */
export function jsonLdGraph(...nodes: object[]) {
  return { "@context": "https://schema.org", "@graph": nodes };
}

export { absoluteUrl, siteUrl };
