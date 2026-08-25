"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { StatsSummary } from "@/lib/analytics";
import { countryFlag, countryName } from "@/lib/requestContext";

/**
 * The analytics dashboard.
 *
 * Built so a number can be produced on demand rather than recalled from memory.
 * Every figure is a live count; nothing here is estimated or extrapolated.
 */
export default function StatsPage() {
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/stats", { cache: "no-store" });
        const data: { success: boolean; stats?: StatsSummary; error?: string } = await res.json();
        if (cancelled) return;
        if (data.success && data.stats) {
          setStats(data.stats);
          setError(null);
          setUpdatedAt(new Date().toLocaleTimeString());
        } else {
          setError(data.error ?? "Could not load stats");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load stats");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    // A dashboard that goes stale while open invites someone to quote an old
    // number, so it refreshes on its own.
    const timer = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-text-primary">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <header className="flex items-start justify-between mb-8 gap-4">
          <div>
            <h1 className="text-2xl font-bold">Monsmith analytics</h1>
            <p className="text-sm text-text-secondary mt-1">
              Live from the database{updatedAt && ` · updated ${updatedAt}`}
            </p>
          </div>
          <Link
            href="/studio"
            className="text-xs font-semibold px-3 py-2 rounded-lg border border-border-subtle hover:border-border-strong transition-colors shrink-0"
          >
            Open studio
          </Link>
        </header>

        {loading && !stats && <p className="text-sm text-text-muted">Loading…</p>}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 mb-6">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {stats && (
          <div className="space-y-8">
            {stats.totalEvents === 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  No activity recorded yet. Tracking started{" "}
                  {stats.firstEventAt ? "recently" : "just now"}, so there is no history to show.
                  Open the studio and reload this page to see it populate.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Metric label="Total users" value={stats.totalUsers} />
              <Metric label="Returning" value={stats.returningUsers} hint="seen on 2+ days" />
              <Metric label="Active 24h" value={stats.activeLast24Hours} />
              <Metric label="Active 7d" value={stats.activeLast7Days} />
              <Metric label="Total events" value={stats.totalEvents} />
              <Metric label="Deployments" value={stats.totalDeployments} />
              <Metric label="Connected wallet" value={stats.walletUsers} />
              <Metric
                label="Tracking since"
                value={stats.firstEventAt ? stats.firstEventAt.slice(0, 10) : "no data"}
              />
            </div>

            <Section title="Funnel">
              <div className="rounded-xl border border-border-subtle p-4 space-y-2">
                {stats.funnel.map((stage) => {
                  const top = stats.funnel[0]?.users || 1;
                  const pct = Math.round((stage.users / top) * 100);
                  return (
                    <div key={stage.stage} className="flex items-center gap-3">
                      <span className="text-xs w-36 shrink-0 text-text-secondary">{stage.stage}</span>
                      <div className="flex-1 h-6 rounded panel-sunken overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-purple-600 to-pink-600 flex items-center justify-end pr-2"
                          style={{ width: `${Math.max(6, pct)}%` }}
                        >
                          <span className="text-[10px] font-bold text-white">{stage.users}</span>
                        </div>
                      </div>
                      <span className="text-[11px] tabular-nums text-text-muted w-10 text-right">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </Section>

            <div className="grid md:grid-cols-2 gap-6">
              <Section title="Countries">
                <RankedList
                  rows={stats.countries.map((c) => ({
                    key: c.country ?? "unknown",
                    label: `${countryFlag(c.country)}  ${countryName(c.country)}`,
                    value: c.users,
                  }))}
                  unit="users"
                />
              </Section>

              <Section title="Cities">
                <RankedList
                  rows={stats.cities.map((c) => ({
                    key: `${c.city}-${c.country}`,
                    label: `${countryFlag(c.country)}  ${c.city}`,
                    value: c.users,
                  }))}
                  unit="users"
                />
              </Section>

              <Section title="Browsers">
                <RankedList
                  rows={stats.browsers.map((b) => ({
                    key: b.name ?? "unknown",
                    label: b.name ?? "Unknown",
                    value: b.users,
                  }))}
                  unit="users"
                />
              </Section>

              <Section title="Operating systems">
                <RankedList
                  rows={stats.operatingSystems.map((o) => ({
                    key: o.name ?? "unknown",
                    label: o.name ?? "Unknown",
                    value: o.users,
                  }))}
                  unit="users"
                />
              </Section>

              <Section title="Devices">
                <RankedList
                  rows={stats.devices.map((d) => ({
                    key: d.name ?? "unknown",
                    label: d.name ?? "Unknown",
                    value: d.users,
                  }))}
                  unit="users"
                />
              </Section>

              <Section title="Traffic sources">
                <RankedList
                  rows={stats.referrers.map((r) => ({
                    key: r.source ?? "direct",
                    label: r.source ?? "direct",
                    value: r.users,
                  }))}
                  unit="users"
                />
              </Section>
            </div>

            <Section title="Feature usage">
              <RankedList
                rows={stats.eventBreakdown.map((e) => ({
                  key: e.type,
                  label: e.type,
                  value: e.count,
                  note: e.errors > 0 ? `${e.errors} failed` : undefined,
                }))}
                unit="times"
              />
            </Section>

            <Section title="Daily activity (30 days)">
              <Bars
                rows={stats.dailyActive.map((d) => ({
                  key: d.day,
                  label: d.day,
                  value: d.events,
                  note: `${d.users} users`,
                }))}
              />
            </Section>

            <Section title="Activity by hour (UTC)">
              <div className="rounded-xl border border-border-subtle p-4 flex items-end gap-1 h-32">
                {Array.from({ length: 24 }, (_, hour) => {
                  const row = stats.hourly.find((h) => h.hour === hour);
                  const peak = Math.max(...stats.hourly.map((h) => h.events), 1);
                  const height = row ? Math.max(4, (row.events / peak) * 100) : 2;
                  return (
                    <div key={hour} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t bg-gradient-to-t from-purple-600 to-pink-500"
                        style={{ height: `${height}%` }}
                        title={`${hour}:00 - ${row?.events ?? 0} events`}
                      />
                      {hour % 6 === 0 && (
                        <span className="text-[9px] text-text-muted">{hour}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>

            {stats.slowest.length > 0 && (
              <Section title="Slowest operations">
                <RankedList
                  rows={stats.slowest.map((s) => ({
                    key: s.type,
                    label: s.type,
                    value: s.avgMs,
                    note: `peak ${s.maxMs}ms`,
                  }))}
                  unit="ms avg"
                />
              </Section>
            )}

            <Section title="Live activity">
              {stats.liveFeed.length === 0 ? (
                <EmptyNote />
              ) : (
                <div className="rounded-xl border border-border-subtle overflow-hidden max-h-96 overflow-y-auto">
                  {stats.liveFeed.map((e, i) => (
                    <div
                      key={`${e.createdAt}-${i}`}
                      className="flex items-center justify-between px-4 py-2 border-b border-border-subtle last:border-0 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            e.status === "error" ? "bg-red-500" : "bg-emerald-500"
                          }`}
                        />
                        <span className="font-mono">{e.type}</span>
                        {e.city && (
                          <span className="text-text-muted truncate">
                            {countryFlag(e.country)} {e.city}
                          </span>
                        )}
                      </div>
                      <span className="text-text-muted tabular-nums shrink-0">
                        {new Date(e.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Recent deployments">
              {stats.recentDeployments.length === 0 ? (
                <EmptyNote />
              ) : (
                <div className="rounded-xl border border-border-subtle overflow-hidden">
                  {stats.recentDeployments.map((d) => (
                    <a
                      key={d.txHash}
                      href={`https://testnet.monadexplorer.com/address/${d.contractAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle last:border-0 hover:bg-border-subtle/40"
                    >
                      <span className="text-sm">{d.contractName ?? "Contract"}</span>
                      <span className="text-[11px] font-mono text-text-muted">
                        {d.contractAddress.slice(0, 10)}…{d.contractAddress.slice(-6)}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </Section>

            <p className="text-[11px] text-text-muted pt-4 border-t border-border-subtle">
              Location is resolved at the edge to country and city only. IP addresses are never
              read or stored.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border-subtle p-4">
      <p className="text-[11px] uppercase tracking-wider text-text-muted">{label}</p>
      <p className="text-2xl font-bold mt-1 tabular-nums">{value}</p>
      {hint && <p className="text-[10px] text-text-muted mt-0.5">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-bold uppercase tracking-wider text-text-muted mb-3">{title}</h2>
      {children}
    </section>
  );
}

interface Row {
  key: string;
  label: string;
  value: number;
  note?: string;
}

function RankedList({ rows, unit }: { rows: Row[]; unit: string }) {
  if (rows.length === 0) return <EmptyNote />;
  const peak = Math.max(...rows.map((r) => r.value), 1);

  return (
    <div className="rounded-xl border border-border-subtle overflow-hidden">
      {rows.map((row) => (
        <div key={row.key} className="relative px-4 py-2.5 border-b border-border-subtle last:border-0">
          <div
            className="absolute inset-y-0 left-0 bg-purple-500/10"
            style={{ width: `${(row.value / peak) * 100}%` }}
          />
          <div className="relative flex items-center justify-between">
            <span className="text-sm truncate">{row.label}</span>
            <span className="text-xs tabular-nums text-text-secondary shrink-0 ml-3">
              {row.value} {unit}
              {row.note && (
                <span className="ml-2 text-red-600 dark:text-red-400">{row.note}</span>
              )}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Bars({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return <EmptyNote />;
  const peak = Math.max(...rows.map((r) => r.value), 1);

  return (
    <div className="rounded-xl border border-border-subtle p-4 space-y-1.5">
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-3">
          <span className="text-[11px] font-mono text-text-muted w-20 shrink-0">{row.label}</span>
          <div className="flex-1 h-4 rounded panel-sunken overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-600 to-pink-600"
              style={{ width: `${Math.max(4, (row.value / peak) * 100)}%` }}
            />
          </div>
          <span className="text-[11px] tabular-nums text-text-secondary w-28 text-right shrink-0">
            {row.note} · {row.value} events
          </span>
        </div>
      ))}
    </div>
  );
}

function EmptyNote() {
  return (
    <div className="rounded-xl border border-border-subtle p-6 text-center">
      <p className="text-sm text-text-secondary">
        Nothing here yet. Open the studio and this fills in within seconds.
      </p>
      <p className="text-xs text-text-muted mt-1">
        Viewing this dashboard is not itself tracked.
      </p>
    </div>
  );
}
