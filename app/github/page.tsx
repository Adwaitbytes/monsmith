import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Check, FileDiff, GitPullRequest, MessageSquareText, ShieldCheck } from "lucide-react";

import { SiteFooter, SiteNav } from "../SiteChrome";
import { publicInstallUrl } from "@/lib/github/app";
import { pullReviewStats, type PullReviewStats } from "@/lib/prReview/store";

export const metadata: Metadata = {
    title: "Monsmith on every pull request",
    description:
        "A GitHub App that audits the Solidity each pull request changes, keeps one comment up to date, marks findings on their lines, tracks which ones each push fixed, and attests the reviewed code on Monad when it merges.",
};

export const dynamic = "force-dynamic";

/** The team's own GitHub accounts, left out of every number on this page. */
function teamLogins(): string[] {
    return (process.env.MONSMITH_TEAM_GITHUB_LOGINS ?? "")
        .split(",")
        .map((login) => login.trim())
        .filter((login) => login.length > 0);
}

async function stats(): Promise<PullReviewStats | null> {
    try {
        return await pullReviewStats(teamLogins());
    } catch (error) {
        console.error("[github page] reading pull request stats failed:", error);
        return null;
    }
}

const STEPS = [
    {
        icon: GitPullRequest,
        title: "A pull request changes a contract",
        body: "Opened, pushed to, or marked ready. Drafts wait. Pull requests that touch no Solidity are left alone, and tests, scripts and dependencies are never audited.",
    },
    {
        icon: ShieldCheck,
        title: "The changed contracts get a full audit",
        body: "The same engine as a report run by hand: a threat model written for this contract, a hunt for exploits against it, a second model cross-examining every finding, and the static and gas passes.",
    },
    {
        icon: MessageSquareText,
        title: "One comment, kept up to date",
        body: "Score, findings worst first, each linked to its line at the reviewed commit, and a check run that puts them on the lines in Files changed. Later pushes edit the same comment, never add another.",
    },
    {
        icon: FileDiff,
        title: "Each push says what it fixed",
        body: "A new push re-checks the earlier findings one by one and re-audits the changed contract in full, so the comment can say which findings that push fixed and whether it introduced any.",
    },
    {
        icon: BadgeCheck,
        title: "Merged code is attested on Monad",
        body: "When the pull request merges, Monsmith reads the merged files and, only if they are byte for byte what it reviewed, writes their score onchain under its ERC-8004 identity. Anyone can check it before calling the code.",
    },
] as const;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-xl border border-border-subtle bg-surface-raised p-4">
            <div className="font-display text-[28px] font-semibold tabular-nums tracking-[-0.02em]">{value}</div>
            <div className="mt-1 text-[13px] font-medium text-text-primary">{label}</div>
            {hint !== undefined && <div className="mt-1 text-[12px] leading-snug text-text-muted">{hint}</div>}
        </div>
    );
}

export default async function GitHubPage({ searchParams }: { searchParams: Promise<{ installed?: string }> }) {
    const { installed } = await searchParams;
    const installUrl = publicInstallUrl();
    const numbers = await stats();
    const excluded = teamLogins();

    return (
        <div className="min-h-screen bg-background text-text-primary">
            <SiteNav />
            <main className="mx-auto max-w-3xl px-6 py-14 sm:py-20">
                {installed === "1" && (
                    <div role="status" className="mb-8 flex items-start gap-3 rounded-xl border border-accent-line bg-accent-soft p-4 text-[14px] leading-relaxed">
                        <Check size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                        <p>
                            Installed. Open a pull request that changes a <code className="font-mono text-[13px]">.sol</code> file and the review
                            appears on it in a minute or two.
                        </p>
                    </div>
                )}

                <p className="inline-flex items-center gap-1.5 rounded-full border border-accent-line bg-accent-soft px-2.5 py-1 text-[11.5px] font-medium text-accent">
                    <GitPullRequest size={12} aria-hidden />
                    GitHub App
                </p>
                <h1 className="mt-5 text-balance font-display text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[44px]">
                    A security review on every pull request that touches a contract.
                </h1>
                <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-text-secondary">
                    Teams ship contract code every week. Install Monsmith once and every pull request that changes Solidity gets a full audit,
                    the findings on their lines, a running count of what each push fixed, and an onchain attestation when it merges.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-3">
                    {installUrl !== null ? (
                        <a
                            href={installUrl}
                            className="inline-flex items-center gap-2 rounded-xl bg-text-primary px-5 py-2.5 text-[14px] font-semibold text-background outline-none ring-accent-line transition-opacity hover:opacity-90 focus-visible:ring-2"
                        >
                            Install on GitHub
                            <ArrowRight size={15} aria-hidden />
                        </a>
                    ) : (
                        <p className="text-[14px] text-text-secondary">The GitHub App is not configured on this deployment.</p>
                    )}
                    <Link
                        href="/studio"
                        className="inline-flex items-center gap-2 rounded-xl border border-border-subtle px-5 py-2.5 text-[14px] font-medium outline-none ring-accent-line transition-colors hover:bg-surface-raised focus-visible:ring-2"
                    >
                        Run one report by hand first
                    </Link>
                </div>
                <p className="mt-3 text-[12.5px] text-text-muted">
                    Free for 60 reviewed pushes per installation every 30 days. Pick the repositories it may read; it asks for nothing else.
                </p>

                <section aria-labelledby="how" className="mt-16">
                    <h2 id="how" className="font-display text-[22px] font-semibold tracking-[-0.02em]">
                        How it works
                    </h2>
                    <ol className="mt-6 space-y-3">
                        {STEPS.map((step, index) => (
                            <li key={step.title} className="flex gap-4 rounded-xl border border-border-subtle bg-surface-raised p-4">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                                    <step.icon size={16} aria-hidden />
                                </span>
                                <div>
                                    <h3 className="text-[14.5px] font-semibold">
                                        <span className="mr-1.5 tabular-nums text-text-muted">{index + 1}.</span>
                                        {step.title}
                                    </h3>
                                    <p className="mt-1 text-[14px] leading-relaxed text-text-secondary">{step.body}</p>
                                </div>
                            </li>
                        ))}
                    </ol>
                </section>

                <section aria-labelledby="numbers" className="mt-16">
                    <h2 id="numbers" className="font-display text-[22px] font-semibold tracking-[-0.02em]">
                        The numbers we are judged by
                    </h2>
                    <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-text-secondary">
                        Not comments posted. Teams that keep it installed, and fixes that merge because of it. Live from the database
                        {excluded.length > 0 ? `, with our own account${excluded.length === 1 ? "" : "s"} (${excluded.join(", ")}) left out` : ""}.
                    </p>
                    {numbers === null ? (
                        <p className="mt-6 text-[14px] text-text-secondary">The numbers could not be read right now.</p>
                    ) : (
                        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                            <Stat label="Teams installed" value={String(numbers.activeInstalls)} />
                            <Stat
                                label="Still running at week four"
                                value={numbers.installsFourWeeksOld === 0 ? "n/a" : `${numbers.retainedAtWeekFour} of ${numbers.installsFourWeeksOld}`}
                                hint="Installed 28+ days ago, still installed, reviewed a pull request in the last 14 days."
                            />
                            <Stat label="Pull requests reviewed" value={String(numbers.pullsReviewed)} hint={`${numbers.reviews} pushes in all`} />
                            <Stat label="Findings fixed before merge" value={String(numbers.findingsFixed)} hint="Gone after a later push to the same pull request." />
                            <Stat label="Fixes merged" value={String(numbers.fixesMerged)} hint={`Across ${numbers.pullsMerged} merged pull requests`} />
                            <Stat label="Merges attested on Monad" value={String(numbers.attestations)} />
                        </div>
                    )}
                </section>

                <section aria-labelledby="access" className="mt-16">
                    <h2 id="access" className="font-display text-[22px] font-semibold tracking-[-0.02em]">
                        What it can touch
                    </h2>
                    <ul className="mt-4 space-y-2 text-[14px] leading-relaxed text-text-secondary">
                        <li>
                            <strong className="font-medium text-text-primary">Contents, read only</strong>, on the repositories you pick, to read the
                            Solidity at the pull request&apos;s commit.
                        </li>
                        <li>
                            <strong className="font-medium text-text-primary">Pull requests and checks, write</strong>, for its one comment and its
                            one check run. It never pushes code, approves, or merges.
                        </li>
                        <li>
                            Monsmith keeps the report it writes (findings and short excerpts of the code they rest on) so the comment can link to
                            it and the next push can be compared with it. It does not keep a copy of your repository.
                        </li>
                    </ul>
                </section>
            </main>
            <SiteFooter />
        </div>
    );
}
