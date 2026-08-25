import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeSync } from "./ThemeSync";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Monsmith | Build. Learn. Ship to Monad.",
  description: "The AI-powered IDE for smart contract development on Monad Network. Write, compile, debug, and deploy - all in your browser.",
  keywords: ["Monad", "Smart Contracts", "Blockchain", "IDE", "Web3", "Solidity", "DeFi", "NFT"],
  authors: [{ name: "Monsmith Team" }],
  openGraph: {
    title: "Monsmith | Build. Learn. Ship to Monad.",
    description: "The AI-powered IDE for smart contract development on Monad Network.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/*
          Applied before paint so a reload does not flash the wrong theme.
          Reads the same localStorage key the zustand store persists to.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('monsmith-theme');var t=s?JSON.parse(s).state.theme:'dark';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased font-sans`}
      >
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
