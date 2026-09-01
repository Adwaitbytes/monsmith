"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

type Item = { label: string; value: number };

interface StatsShape {
  totalUsers?: number;
  totalDeployments?: number;
  eventBreakdown?: { type: string; count: number }[];
}

/**
 * A small strip of real usage, read live from /api/stats. Deliberately honest:
 * it renders nothing at all unless the numbers are real and non-zero, so the
 * landing never shows fabricated or empty metrics.
 */
export function LiveStats() {
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stats")
      .then((r) => r.json())
      .then((d: { success?: boolean; stats?: StatsShape }) => {
        if (cancelled || !d?.success || !d.stats?.totalUsers) return;
        const s = d.stats;
        const count = (t: string) => s.eventBreakdown?.find((e) => e.type === t)?.count ?? 0;
        const next: Item[] = [
          { label: "developers", value: s.totalUsers ?? 0 },
          { label: "contracts compiled", value: count("compile") },
          { label: "deployed to Monad", value: s.totalDeployments ?? 0 },
          { label: "parallel analyses", value: count("parallel_analysis") },
        ].filter((i) => i.value > 0);
        if (next.length) setItems(next);
      })
      .catch(() => {
        /* stats are best-effort; the strip simply stays hidden */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!items) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.6 }}
      className="mt-12 flex flex-wrap items-end gap-x-10 gap-y-5 border-t border-border-subtle pt-8"
    >
      <span className="flex items-center gap-2 self-center font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        Live usage
      </span>
      {items.map((s) => (
        <div key={s.label}>
          <div className="font-display text-2xl font-semibold tabular-nums text-text-primary sm:text-3xl">
            {s.value.toLocaleString()}
          </div>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-wide text-text-muted">
            {s.label}
          </div>
        </div>
      ))}
    </motion.div>
  );
}
