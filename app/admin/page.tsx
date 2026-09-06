import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { clerkClient } from "@clerk/nextjs/server";

import { can, TIER_LABELS, TIER_LIMITS, parseRole, parseTier } from "@/lib/auth/roles";
import { getViewer } from "@/lib/auth/server";

import { MonsmithMark } from "../landing/MonsmithMark";
import { TierControl } from "./TierControl";

/**
 * The admin area.
 *
 * Access is decided here, on the server, and not by the proxy alone. The proxy
 * establishes that you are signed in; this establishes that you are an admin.
 * Keeping the second check next to the data it guards is what stops a future
 * route being added to the folder and quietly inheriting only the weaker one.
 */

export const metadata: Metadata = {
    title: "Admin · Monsmith",
    robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface AccountRow {
    id: string;
    email: string;
    name: string;
    role: string;
    tier: string;
    createdAt: number;
    lastActiveAt: number | null;
}

async function loadAccounts(): Promise<{ rows: AccountRow[]; error: string | null }> {
    try {
        const client = await clerkClient();
        const { data } = await client.users.getUserList({ limit: 100, orderBy: "-created_at" });

        const rows = data.map((user) => {
            const metadata = user.publicMetadata as { role?: unknown; tier?: unknown };
            return {
                id: user.id,
                email: user.primaryEmailAddress?.emailAddress ?? "no email",
                name: [user.firstName, user.lastName].filter(Boolean).join(" ") || "—",
                role: parseRole(metadata.role),
                tier: parseTier(metadata.tier),
                createdAt: user.createdAt,
                lastActiveAt: user.lastActiveAt,
            };
        });

        return { rows, error: null };
    } catch (error) {
        return {
            rows: [],
            error: error instanceof Error ? error.message : "Could not reach Clerk.",
        };
    }
}

function dateText(value: number | null): string {
    if (value === null) return "—";
    return new Date(value).toLocaleDateString("en-US", { dateStyle: "medium" });
}

export default async function AdminPage() {
    const viewer = await getViewer();

    // Not an admin is not an error worth explaining. Anyone signed in who is
    // not an admin has no reason to know this page exists.
    if (!can(viewer, "admin.users")) redirect("/");

    const { rows, error } = await loadAccounts();

    return (
        <main className="min-h-screen bg-background text-text-primary">
            <nav className="border-b border-border-subtle px-6 py-4">
                <div className="mx-auto flex max-w-6xl items-center justify-between">
                    <Link href="/" className="flex items-center gap-2.5">
                        <MonsmithMark className="h-6 w-6" />
                        <span className="font-display text-[15px] font-semibold tracking-tight">
                            Monsmith
                        </span>
                    </Link>
                    <div className="flex items-center gap-4 text-[13px]">
                        <Link href="/stats" className="text-text-muted transition-colors hover:text-text-primary">
                            Usage
                        </Link>
                        <Link href="/studio" className="text-text-muted transition-colors hover:text-text-primary">
                            Studio
                        </Link>
                        <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[12px] font-medium text-accent">
                            {viewer.email ?? "admin"}
                        </span>
                    </div>
                </div>
            </nav>

            <section className="mx-auto max-w-6xl px-6 py-12">
                <h1 className="font-display text-3xl font-semibold tracking-tight">Accounts</h1>
                <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-text-secondary">
                    Everyone who has signed in, and what they are entitled to. Tiers set here take
                    effect on the account&apos;s next request. Pricing is not decided yet, so the
                    limits below are the ones the code enforces, not a published plan.
                </p>

                {error !== null && (
                    <div className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4">
                        <p className="text-[13px] text-red-700 dark:text-red-300">
                            Could not load accounts: {error}
                        </p>
                    </div>
                )}

                <div className="mt-8 overflow-x-auto rounded-2xl border border-border-subtle">
                    <table className="w-full min-w-[760px] border-collapse">
                        <thead>
                            <tr className="bg-surface-sunken/60">
                                {["Account", "Role", "Tier", "Joined", "Last seen", ""].map((label) => (
                                    <th
                                        key={label}
                                        className="border-b border-border-strong px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-muted"
                                    >
                                        {label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 && error === null && (
                                <tr>
                                    <td colSpan={6} className="px-4 py-8 text-center text-[13px] text-text-muted">
                                        Nobody has signed in yet.
                                    </td>
                                </tr>
                            )}
                            {rows.map((row) => (
                                <tr key={row.id}>
                                    <td className="border-b border-border-subtle px-4 py-3">
                                        <span className="block text-[13px] text-text-primary">{row.email}</span>
                                        <span className="block text-[11px] text-text-muted">{row.name}</span>
                                    </td>
                                    <td className="border-b border-border-subtle px-4 py-3">
                                        <span
                                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                                row.role === "admin"
                                                    ? "bg-accent-soft text-accent"
                                                    : "text-text-muted"
                                            }`}
                                        >
                                            {row.role}
                                        </span>
                                    </td>
                                    <td className="border-b border-border-subtle px-4 py-3">
                                        <TierControl userId={row.id} tier={row.tier} />
                                    </td>
                                    <td className="border-b border-border-subtle px-4 py-3 text-[12.5px] text-text-secondary">
                                        {dateText(row.createdAt)}
                                    </td>
                                    <td className="border-b border-border-subtle px-4 py-3 text-[12.5px] text-text-secondary">
                                        {dateText(row.lastActiveAt)}
                                    </td>
                                    <td className="border-b border-border-subtle px-4 py-3 text-right">
                                        <span className="font-mono text-[10.5px] text-text-muted">
                                            {row.id.slice(0, 14)}…
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <h2 className="mt-14 font-display text-xl font-semibold tracking-tight">
                    What each tier gets today
                </h2>
                <div
                    className="mt-5 grid gap-3"
                    style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
                >
                    {(Object.keys(TIER_LIMITS) as (keyof typeof TIER_LIMITS)[]).map((tier) => {
                        const limits = TIER_LIMITS[tier];
                        return (
                            <div key={tier} className="rounded-xl border border-border-subtle p-4">
                                <h3 className="text-[14px] font-semibold text-text-primary">
                                    {TIER_LABELS[tier]}
                                </h3>
                                <dl className="mt-3 space-y-1.5 text-[12.5px]">
                                    <div className="flex justify-between gap-3">
                                        <dt className="text-text-muted">Analyses / day</dt>
                                        <dd className="font-mono text-text-primary">
                                            {limits.analysesPerDay ?? "unlimited"}
                                        </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                        <dt className="text-text-muted">Max source</dt>
                                        <dd className="font-mono text-text-primary">
                                            {Math.round(limits.maxSourceBytes / 1024)} KB
                                        </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                        <dt className="text-text-muted">Chains compared</dt>
                                        <dd className="font-mono text-text-primary">{limits.maxChains}</dd>
                                    </div>
                                </dl>
                            </div>
                        );
                    })}
                </div>

                <p className="mt-6 max-w-3xl text-[12.5px] leading-relaxed text-text-muted">
                    Admin rights come from the <span className="font-mono">CLERK_ADMIN_EMAILS</span>{" "}
                    environment variable, which is read only on the server. An account cannot be made
                    admin by editing its own profile metadata, and adding an admin does not require a
                    deploy.
                </p>
            </section>
        </main>
    );
}
