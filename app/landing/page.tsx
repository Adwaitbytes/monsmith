"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  FileCode2,
  Network,
  Cpu,
  UploadCloud,
  GitCompareArrows,
  ShieldCheck,
  Sun,
  Moon,
  Check,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useThemeStore } from "@/lib/store";
import { useHydrated } from "@/lib/useHydrated";
import { track } from "@/lib/track";
import { MonsmithMark } from "./MonsmithMark";
import { AuthControls } from "../AuthControls";
import { useViewer } from "@/lib/auth/useViewer";
import { ExecutionGraph } from "./ExecutionGraph";
import { LiveStats } from "./LiveStats";
import { FAQ, FOUNDER } from "@/lib/seo";
import { SiteFooter } from "../SiteChrome";
import {
  SmoothScroll,
  ScrollProgress,
  RevealWords,
  Magnetic,
  Parallax,
  AnimatedRule,
} from "./motion";

// WebGL hero backdrop; client-only and lazy so it never blocks first paint.
const HeroScene = dynamic(() => import("./HeroScene"), { ssr: false });

const REVEAL: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

const reveal = {
  variants: REVEAL,
  initial: "hidden" as const,
  whileInView: "show" as const,
  viewport: { once: true, margin: "-80px" },
};

const EASE = [0.16, 1, 0.3, 1] as const;

/** A single headline line that rises out from a clip mask on load. */
function MaskLine({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <span className="block overflow-hidden pb-[0.08em]">
      <motion.span
        className={`block ${className ?? ""}`}
        initial={reduce ? { opacity: 0 } : { y: "110%" }}
        animate={reduce ? { opacity: 1 } : { y: 0 }}
        transition={{ duration: 0.9, ease: EASE, delay }}
      >
        {children}
      </motion.span>
    </span>
  );
}

/** Small mono label that sits above a section title. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
      <span className="h-px w-6 bg-accent-line" />
      {children}
    </div>
  );
}

export default function LandingPage() {
  const { theme, toggleTheme } = useThemeStore();
  const mounted = useHydrated();
  const { viewer } = useViewer();
  const reduce = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    track("page_view", { detail: { page: "landing" } });
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Rendered on the server so crawlers and answer engines index the full
  // page. The only theme-dependent pieces are the toggle icon and the WebGL
  // hero, which is client-only already, so the server can assume light and
  // let the client correct it after hydration without a mismatch.
  const isDark = mounted && theme === "dark";

  return (
    <div className="min-h-screen bg-background text-text-primary selection:bg-accent-soft">
      <SmoothScroll />
      <ScrollProgress />
      {/* ---------------------------------------------------------------- Nav */}
      <motion.nav
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300 ${
          scrolled
            ? "border-border-subtle bg-background/80 backdrop-blur-xl"
            : "border-transparent bg-transparent"
        }`}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="group flex items-center gap-2.5">
            <MonsmithMark size={27} className="transition-transform duration-300 group-hover:scale-110" />
            <span className="font-display text-lg font-semibold tracking-tight">Monsmith</span>
          </Link>

          <div className="hidden items-center gap-8 md:flex">
            {[
              ["Workflow", "#workflow"],
              ["Product", "#product"],
              ["Chain Fit", "/compare"],
              ["Learn", "/learn"],
              ["Guide", "/guide"],
              ["Glossary", "/glossary"],
              ["About", "/about"],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
                className="group relative text-sm text-text-secondary transition-colors hover:text-text-primary"
              >
                {label}
                <span className="absolute -bottom-1.5 left-0 h-px w-0 bg-accent transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:w-full" />
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="grid h-9 w-9 place-items-center rounded-full border border-border-subtle text-text-secondary transition-colors hover:text-text-primary"
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <AuthControls compact tier={viewer.tier} isAdmin={viewer.role === "admin"} />
            <Magnetic strength={0.4}>
              <Link
                href="/studio"
                onClick={() => track("page_view", { detail: { event: "cta_click", cta: "nav_open_studio" } })}
                className="group inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition-transform hover:-translate-y-0.5"
              >
                Open Studio
                <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Magnetic>
          </div>
        </div>
      </motion.nav>

      {/* --------------------------------------------------------------- Hero */}
      <section className="relative overflow-hidden px-6 pb-24 pt-36">
        <div className="pointer-events-none absolute inset-0 blueprint-grid opacity-40" />
        {/* WebGL parallel-execution field, masked so it fades behind the headline */}
        <div className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(130%_105%_at_74%_18%,black,transparent_72%)]">
          <HeroScene dark={isDark} />
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] accent-veil" />

        <div className="relative mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <motion.div {...reveal}>
              <Eyebrow>Smart contract studio · built for Monad</Eyebrow>
            </motion.div>
            <h1 className="mt-6 font-display text-5xl font-semibold leading-[1.02] tracking-tight sm:text-6xl md:text-7xl">
              <MaskLine delay={0.05}>Build for Monad</MaskLine>
              <MaskLine delay={0.16} className="text-accent">
                Execute without friction
              </MaskLine>
            </h1>
            <motion.p
              {...reveal}
              transition={{ ...REVEAL.show, delay: 0.35 }}
              className="mt-7 max-w-xl text-lg leading-relaxed text-text-secondary"
            >
              A browser-based studio to write, profile, deploy, and migrate smart
              contracts, with Monad&apos;s parallel execution in view the whole way.
            </motion.p>
            <motion.p
              {...reveal}
              transition={{ ...REVEAL.show, delay: 0.4 }}
              className="mt-4 text-sm text-text-muted"
            >
              Free to use. Nothing to install, no account to open.
            </motion.p>

            <motion.div {...reveal} transition={{ ...REVEAL.show, delay: 0.45 }} className="mt-9 flex flex-wrap items-center gap-3">
              <Magnetic strength={0.4}>
                <Link
                  href="/studio"
                  onClick={() => track("page_view", { detail: { event: "cta_click", cta: "hero_open_studio" } })}
                  className="group inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-base font-medium text-white shadow-[0_8px_30px_-8px] shadow-accent transition-transform hover:-translate-y-0.5"
                >
                  Open Studio
                  <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Magnetic>
              <Magnetic strength={0.25}>
                <a
                  href="#workflow"
                  className="inline-flex items-center gap-2 rounded-full border border-border-strong px-6 py-3 text-base font-medium text-text-primary transition-colors hover:bg-surface-raised"
                >
                  See how it works
                </a>
              </Magnetic>
            </motion.div>
          </div>

          {/* Signature execution graph */}
          <motion.div
            {...reveal}
            transition={{ ...REVEAL.show, delay: 0.15 }}
            className="mt-16 rounded-2xl border border-border-subtle bg-surface-base/70 p-4 shadow-[var(--shadow-panel)] backdrop-blur-sm sm:p-8"
          >
            <Parallax amount={26}>
              <ExecutionGraph className="mx-auto max-w-3xl" />
            </Parallax>
          </motion.div>

          {/* Status line */}
          <motion.div
            {...reveal}
            className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
          >
            {["Monad", "EVM compatible", "Parallel execution", "Browser native"].map((s, i) => (
              <span key={s} className="flex items-center gap-6">
                {i > 0 && <span className="h-1 w-1 rounded-full bg-accent" />}
                {s}
              </span>
            ))}
          </motion.div>

          {/* Live usage, real numbers from /api/stats (hidden until non-zero) */}
          <LiveStats />
        </div>
      </section>

      {/* -------------------------------------------------------- Proof strip */}
      <section className="border-y border-border-subtle bg-surface-sunken/50">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-4 px-6 py-6 font-mono text-xs text-text-muted">
          {[
            "Solidity 0.8.24",
            "Hardhat pipeline",
            "OpenZeppelin resolved",
            "45 / 45 tests passing",
            "Monad testnet + mainnet",
          ].map((f) => (
            <span key={f} className="flex items-center gap-2">
              <Check size={13} className="text-accent" />
              {f}
            </span>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ Problem */}
      <section className="px-6 py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-14 md:grid-cols-2">
          <motion.div {...reveal}>
            <Eyebrow>The shift</Eyebrow>
            <h2 className="mt-6 font-display text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              <RevealWords text="Monad changed how execution works. Your workflow should see it" />
            </h2>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-text-secondary">
              Your Solidity and your tooling already run on Monad. What&apos;s missing
              is a workspace that treats parallel execution as a first-class part of
              writing contracts, not an afterthought at deploy time.
            </p>
          </motion.div>

          <motion.div {...reveal} className="relative">
            <div className="grid grid-cols-2 gap-3">
              {["Editor", "Compiler", "Terminal", "RPC", "Explorer", "Profiler"].map((t, i) => (
                <motion.div
                  key={t}
                  {...reveal}
                  transition={{ ...REVEAL.show, delay: 0.05 * i }}
                  className="rounded-xl border border-border-subtle bg-surface-base px-4 py-3 font-mono text-sm text-text-muted transition-colors duration-300 hover:border-accent-line hover:text-text-secondary"
                >
                  {t}
                </motion.div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-accent-line bg-accent-soft px-4 py-4">
              <MonsmithMark size={22} />
              <span className="font-display font-semibold text-text-primary">
                One workspace
              </span>
              <span className="ml-auto font-mono text-xs text-text-muted">converged</span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ------------------------------------------------------- Core loop */}
      <section id="workflow" className="border-t border-border-subtle bg-surface-sunken/30 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <motion.div {...reveal} className="max-w-2xl">
            <Eyebrow>The loop</Eyebrow>
            <h2 className="mt-6 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
              <RevealWords text="From contract to execution, without leaving the workspace" />
            </h2>
          </motion.div>

          <AnimatedRule className="mt-10 w-full" />

          <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-border-subtle bg-border-subtle sm:grid-cols-2 lg:grid-cols-5">
            {[
              { n: "01", label: "Write", icon: FileCode2, desc: "Monaco editor with Solidity highlighting, autocomplete, and multi-file projects." },
              { n: "02", label: "Profile", icon: Network, desc: "Storage-dependency analysis scores where functions can run in parallel." },
              { n: "03", label: "Execute", icon: Cpu, desc: "Compile through Hardhat with OpenZeppelin resolved and clear diagnostics." },
              { n: "04", label: "Deploy", icon: UploadCloud, desc: "Ship to Monad testnet or mainnet and interact with the live contract." },
              { n: "05", label: "Migrate", icon: GitCompareArrows, desc: "Move a contract forward with a guided plan and a side-by-side diff." },
            ].map((s, i) => (
              <motion.div
                key={s.n}
                {...reveal}
                transition={{ ...REVEAL.show, delay: 0.06 * i }}
                className="group bg-surface-base p-6 transition-all duration-300 hover:bg-surface-raised hover:ring-1 hover:ring-inset hover:ring-accent-line"
              >
                <div className="flex items-center justify-between">
                  <s.icon size={20} className="text-accent transition-transform duration-300 group-hover:-translate-y-0.5" />
                  <span className="font-mono text-xs text-text-muted">{s.n}</span>
                </div>
                <h3 className="mt-5 font-display text-xl font-semibold">{s.label}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- Parallel execution */}
      <section id="execution" className="border-t border-border-subtle px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="grid items-start gap-14 lg:grid-cols-[1fr_1.1fr]">
            <motion.div {...reveal}>
              <Eyebrow>Parallel execution</Eyebrow>
              <h2 className="mt-6 font-display text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
                <RevealWords text={"Don\u2019t just deploy to Monad. Build with its execution model in mind"} />
              </h2>
              <p className="mt-6 text-lg leading-relaxed text-text-secondary">
                Monad runs independent transactions at the same time and serializes
                only where they touch the same state. The profiler reads your storage
                access and shows you which is which, function by function.
              </p>

              <div className="mt-8 grid grid-cols-2 gap-3">
                {[
                  { k: "Parallelism score", v: "per function" },
                  { k: "Execution waves", v: "ordered" },
                  { k: "Storage conflicts", v: "flagged" },
                  { k: "Dependency graph", v: "visual" },
                ].map((m) => (
                  <div key={m.k} className="rounded-xl border border-border-subtle bg-surface-base p-4">
                    <div className="font-mono text-[11px] uppercase tracking-wide text-text-muted">
                      {m.v}
                    </div>
                    <div className="mt-1 font-display text-base font-semibold">{m.k}</div>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div {...reveal} transition={{ ...REVEAL.show, delay: 0.12 }}>
              <SchedulerCompare reduce={!!reduce} />
            </motion.div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- Product */}
      <section id="product" className="border-t border-border-subtle bg-surface-sunken/30 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <motion.div {...reveal} className="mb-12 max-w-2xl">
            <Eyebrow>The workspace</Eyebrow>
            <h2 className="mt-6 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
              <RevealWords text="Editor, profiler, and deploy console in one view" />
            </h2>
          </motion.div>

          <motion.div
            {...reveal}
            className="overflow-hidden rounded-2xl border border-border-subtle bg-surface-base shadow-[var(--shadow-panel)]"
          >
            <Parallax amount={22}>
              <DemoVideo />
            </Parallax>
          </motion.div>

          <div className="mt-6 flex justify-center">
            <Link
              href="/studio"
              onClick={() => track("page_view", { detail: { event: "cta_click", cta: "product_open_studio" } })}
              className="inline-flex items-center gap-2 text-sm font-medium text-accent transition-colors hover:opacity-80"
            >
              Open the real thing
              <ArrowUpRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- Migration + Security */}
      <section className="border-t border-border-subtle px-6 py-20">
        <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-2">
          <motion.div {...reveal} className="group rounded-2xl border border-border-subtle bg-surface-base p-8 transition-all duration-300 hover:-translate-y-1 hover:border-accent-line hover:shadow-[var(--shadow-panel)]">
            <GitCompareArrows size={22} className="text-accent" />
            <h3 className="mt-5 font-display text-2xl font-semibold">Migrate without rebuilding the flow</h3>
            <p className="mt-3 leading-relaxed text-text-secondary">
              Point the wizard at an old contract, review the plan, and see a
              line-by-line diff before you commit the new version.
            </p>
            <div className="mt-6 flex items-center gap-3 font-mono text-sm">
              <span className="rounded-md border border-border-subtle px-3 py-1.5 text-text-muted">Contract v1</span>
              <ArrowRight size={16} className="text-accent" />
              <span className="rounded-md border border-accent-line bg-accent-soft px-3 py-1.5 text-accent">Contract v2</span>
            </div>
          </motion.div>

          <motion.div {...reveal} transition={{ ...REVEAL.show, delay: 0.08 }} className="group rounded-2xl border border-border-subtle bg-surface-base p-8 transition-all duration-300 hover:-translate-y-1 hover:border-accent-line hover:shadow-[var(--shadow-panel)]">
            <ShieldCheck size={22} className="text-accent" />
            <h3 className="mt-5 font-display text-2xl font-semibold">Understand it before you ship it</h3>
            <p className="mt-3 leading-relaxed text-text-secondary">
              The audit scans for reentrancy, overflow, and access-control issues,
              scores the risk, and points at the lines that need attention.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 font-mono text-xs">
              {["reentrancy", "overflow", "access control", "risk score"].map((t) => (
                <span key={t} className="rounded-md border border-border-subtle px-2.5 py-1 text-text-muted">
                  {t}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ------------------------------------------------- Built around Monad */}
      <section className="border-t border-border-subtle px-6 py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-14 md:grid-cols-2">
          <motion.div {...reveal}>
            <Eyebrow>Built around Monad</Eyebrow>
            <h2 className="mt-6 font-display text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              <RevealWords text="One EVM. A different execution environment" />
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-text-secondary">
              Monad keeps EVM compatibility, so your contracts, languages, and
              libraries stay the same. Monsmith adds the layer that makes the
              workflow aware of how Monad actually executes them.
            </p>
          </motion.div>
          <motion.ul {...reveal} transition={{ ...REVEAL.show, delay: 0.1 }} className="space-y-3">
            {[
              "Familiar Solidity and OpenZeppelin, compiled with the standard toolchain",
              "Storage-level analysis surfaced while you write, not after you deploy",
              "Deploy and interact on Monad testnet and mainnet from the browser",
            ].map((t) => (
              <li key={t} className="flex gap-3 rounded-xl border border-border-subtle bg-surface-base px-5 py-4 transition-colors duration-300 hover:border-accent-line">
                <Check size={18} className="mt-0.5 shrink-0 text-accent" />
                <span className="text-text-secondary">{t}</span>
              </li>
            ))}
          </motion.ul>
        </div>
      </section>

      {/* ------------------------------------------------------------ Roadmap */}
      <section id="roadmap" className="border-t border-border-subtle bg-surface-sunken/30 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <motion.div {...reveal} className="max-w-2xl">
            <Eyebrow>Build in public</Eyebrow>
            <h2 className="mt-6 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
              <RevealWords text="One product, shipped in the open" />
            </h2>
          </motion.div>

          <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-border-subtle bg-border-subtle sm:grid-cols-2 lg:grid-cols-4">
            {[
              { d: "Now", t: "Core workflow", s: "Editor, compile, deploy, audit live in the browser." },
              { d: "Next", t: "Deeper profiling", s: "Richer dependency graphs and per-wave detail." },
              { d: "Then", t: "Migration paths", s: "Guided upgrades with verification built in." },
              { d: "Open", t: "Whatever it needs", s: "Shaped by the developers who use it." },
            ].map((m, i) => (
              <motion.div
                key={m.t}
                {...reveal}
                transition={{ ...REVEAL.show, delay: 0.06 * i }}
                className="bg-surface-base p-6 transition-all duration-300 hover:bg-surface-raised hover:ring-1 hover:ring-inset hover:ring-accent-line"
              >
                <span className="font-mono text-xs uppercase tracking-wide text-accent">{m.d}</span>
                <h3 className="mt-4 font-display text-lg font-semibold">{m.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">{m.s}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- FAQ */}
      <section id="faq" className="border-t border-border-subtle px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <motion.div {...reveal} className="max-w-2xl">
            <Eyebrow>Questions</Eyebrow>
            <h2 className="mt-6 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
              <RevealWords text="What people ask about Monsmith" />
            </h2>
          </motion.div>

          <div className="mt-14 grid gap-x-12 gap-y-2 lg:grid-cols-2">
            {FAQ.map((item, i) => (
              <motion.details
                key={item.q}
                {...reveal}
                transition={{ ...REVEAL.show, delay: 0.04 * i }}
                className="group border-b border-border-subtle py-5"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-lg font-semibold [&::-webkit-details-marker]:hidden">
                  <h3 className="text-lg font-semibold">{item.q}</h3>
                  <span aria-hidden className="font-mono text-accent transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-text-secondary">{item.a}</p>
              </motion.details>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- Credit */}
      {/*
        A single line, near the bottom, on purpose. Who built a tool is worth
        stating plainly and worth nothing shouted: the authorship that search
        and answer engines read comes from the Person schema and /adwait-keshari,
        not from the size of the type here.
      */}
      <section id="founder" className="border-t border-border-subtle px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
          <p className="text-sm text-text-muted">
            Built by{" "}
            <Link
              href="/adwait-keshari"
              className="font-medium text-text-secondary underline decoration-border-strong underline-offset-4 transition-colors hover:text-text-primary hover:decoration-accent"
            >
              {FOUNDER.name}
            </Link>
            .
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- CTA */}
      <section className="relative overflow-hidden border-t border-border-subtle px-6 py-24">
        <div className="pointer-events-none absolute inset-0 accent-veil opacity-70" />
        <motion.div {...reveal} className="relative mx-auto max-w-2xl text-center">
          <MonsmithMark size={44} className="mx-auto block" />
          <h2 className="mt-8 font-display text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            <RevealWords text="Your contracts are ready. Your workspace should be too" />
          </h2>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Magnetic strength={0.4}>
              <Link
                href="/studio"
                onClick={() => track("page_view", { detail: { event: "cta_click", cta: "footer_open_studio" } })}
                className="group inline-flex items-center gap-2 rounded-full bg-accent px-7 py-3.5 text-base font-medium text-white shadow-[0_8px_30px_-8px] shadow-accent transition-transform hover:-translate-y-0.5"
              >
                Open Monsmith
                <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Magnetic>
            <Magnetic strength={0.25}>
              <Link
                href="/tutorials/erc20-token"
                className="inline-flex items-center gap-2 rounded-full border border-border-strong px-7 py-3.5 text-base font-medium transition-colors hover:bg-surface-raised"
              >
                Start a tutorial
              </Link>
            </Magnetic>
          </div>
        </motion.div>
      </section>

      {/* -------------------------------------------------------------- Footer */}
      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

/**
 * Schematic of the same six transactions run sequentially vs. scheduled into
 * parallel lanes on Monad. It illustrates the shape of the win — independent
 * work packs together — not a measured benchmark, so it carries no numbers.
 */
function SchedulerCompare({ reduce }: { reduce: boolean }) {
  const blocks = [
    { w: 22, dep: false },
    { w: 16, dep: false },
    { w: 20, dep: false },
    { w: 18, dep: true },
    { w: 14, dep: true },
    { w: 20, dep: true },
  ];
  // Parallel packing: three lanes, dependent block trails its lane's first.
  const lanes = [
    [blocks[0], blocks[3]],
    [blocks[1], blocks[4]],
    [blocks[2], blocks[5]],
  ];

  const Bar = ({ w, dep, delay }: { w: number; dep: boolean; delay: number }) => (
    <motion.div
      initial={reduce ? false : { scaleX: 0 }}
      whileInView={reduce ? undefined : { scaleX: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      style={{ width: `${w}%`, transformOrigin: "left" }}
      className={`h-7 rounded-md ${
        dep ? "border border-accent-line bg-accent-soft" : "bg-accent"
      }`}
    />
  );

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-base p-6">
      <div className="mb-2 font-mono text-[11px] uppercase tracking-wide text-text-muted">
        Sequential
      </div>
      <div className="flex flex-wrap gap-1.5">
        {blocks.map((b, i) => (
          <Bar key={i} w={b.w} dep={false} delay={0.05 * i} />
        ))}
      </div>

      <div className="my-6 h-px bg-border-subtle" />

      <div className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-wide text-text-muted">
        <span>Parallel · Monad</span>
        <span className="text-accent">3 lanes</span>
      </div>
      <div className="space-y-1.5">
        {lanes.map((lane, i) => (
          <div key={i} className="flex gap-1.5">
            {lane.map((b, j) => (
              <Bar key={j} w={b.w * 1.6} dep={b.dep} delay={0.1 * i + 0.05 * j} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-4 font-mono text-[11px] text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" /> independent
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border border-accent-line bg-accent-soft" /> waits on shared state
        </span>
      </div>
    </div>
  );
}

/** The product film, autoplaying muted and looping; poster + no autoplay under reduced motion. */
function DemoVideo() {
  const reduce = useReducedMotion();
  return (
    <video
      className="block w-full"
      poster="/monsmith-demo-poster.jpg"
      autoPlay={!reduce}
      muted
      loop
      playsInline
      preload="metadata"
      aria-label="Monsmith studio in motion: editor, execution profiler, and deploy console"
    >
      <source src="/monsmith-demo.mp4" type="video/mp4" />
    </video>
  );
}
