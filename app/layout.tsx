import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { ThemeSync } from "./ThemeSync";

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

const description =
  "A browser-based smart contract studio for Monad. Write, audit, profile, deploy, and migrate contracts with parallel execution in view, all from the browser.";

export const metadata: Metadata = {
  title: "Monsmith · Smart Contract Studio for Monad",
  description,
  keywords: ["Monad", "Smart Contracts", "Solidity", "Parallel EVM", "IDE", "Web3", "Deployment"],
  authors: [{ name: "Monsmith" }],
  icons: { icon: "/monsmith-logo.svg" },
  openGraph: {
    title: "Monsmith · Smart Contract Studio for Monad",
    description,
    type: "website",
  },
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
          Reads the same localStorage key the zustand store persists to.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('monsmith-theme');var t=s?JSON.parse(s).state.theme:'light';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} antialiased font-sans`}
      >
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
