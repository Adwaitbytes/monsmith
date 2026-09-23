import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { ThemeSync } from "./ThemeSync";
import { PostHogProvider } from "./PostHogProvider";
import { AuthProvider } from "./AuthProvider";
import { JsonLd } from "./JsonLd";
import { VoiceAgent } from "./VoiceAgent";
import {
  FOUNDER,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_NAME,
  SITE_TITLE,
  absoluteUrl,
  siteUrl,
  founderJsonLd,
  jsonLdGraph,
  organizationJsonLd,
  websiteJsonLd,
} from "@/lib/seo";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: SITE_TITLE,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [...SITE_KEYWORDS],
  authors: [{ name: FOUNDER.name, url: absoluteUrl("/adwait-keshari") }],
  creator: FOUNDER.name,
  publisher: SITE_NAME,
  category: "technology",
  classification: "Developer Tools",
  referrer: "origin-when-cross-origin",
  formatDetection: { email: false, address: false, telephone: false },
  alternates: {
    canonical: "/",
    languages: { en: "/", "x-default": "/" },
    types: { "application/rss+xml": "/feed.xml" },
  },
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
    yandex: process.env.NEXT_PUBLIC_YANDEX_VERIFICATION,
    other: {
      ...(process.env.NEXT_PUBLIC_BING_VERIFICATION
        ? { "msvalidate.01": process.env.NEXT_PUBLIC_BING_VERIFICATION }
        : {}),
    },
  },
  icons: {
    icon: [{ url: "/monsmith-logo.svg", type: "image/svg+xml" }, { url: "/favicon.ico" }],
    apple: "/monsmith-logo.svg",
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    url: "/",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    site: FOUNDER.socials.twitterHandle,
    creator: FOUNDER.socials.twitterHandle,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  other: {
    "ai-content-declaration": "human-authored",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0f" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        {/*
          Applied before paint so a reload does not flash the wrong theme.
          Reads the same localStorage key the zustand store persists to, and
          falls back to the operating system's preference rather than to light,
          so a first visit in a dark environment does not arrive bright white.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('monsmith-theme');var t=s?JSON.parse(s).state.theme:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}catch(e){}})();`,
          }}
        />
        {/* Site-wide entity graph: who publishes this site and who built it. */}
        <JsonLd data={jsonLdGraph(organizationJsonLd(), websiteJsonLd(), founderJsonLd())} />
      </head>
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} antialiased font-sans`}
      >
        <ThemeSync />
        <AuthProvider>
          <PostHogProvider>{children}</PostHogProvider>
        </AuthProvider>
        {/*
          A line to a person, on every page.

          It sits in the layout rather than in the studio because the questions
          it exists for arrive from anywhere: someone reading the landing page
          deciding whether this fits their team, someone on a shared report
          wondering who produced it. Putting it only where the code is would
          miss most of the people who want it.
        */}
        <VoiceAgent />
      </body>
    </html>
  );
}
