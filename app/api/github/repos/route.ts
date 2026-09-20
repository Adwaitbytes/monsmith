import { NextResponse } from "next/server";

import { getApiViewer } from "@/lib/auth/server";
import {
    forgetInstallationToken,
    githubAppConfigured,
    installUrl,
    issueInstallState,
} from "@/lib/github/app";
import { installationSource } from "@/lib/github/installationSource";
import { GitHubError, type RepoSummary } from "@/lib/github/source";
import { installationsFor, removeInstallation } from "@/lib/report/store";

/**
 * The repositories this viewer can import without typing a URL.
 *
 * Always a 200. "Not connected" is not an error, it is the state almost every
 * first-time viewer is in, and the response carries the install URL so the
 * picker can render its own empty state without a second request.
 *
 * A viewer can hold more than one installation (their personal account plus an
 * organisation, typically), so the lists are merged and de-duplicated by full
 * name. One installation failing must not hide the others, and an installation
 * GitHub no longer knows about is deleted rather than retried forever.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export async function GET() {
    const viewer = await getApiViewer();
    const userId = viewer.userId;

    if (!githubAppConfigured() || userId === null) {
        return NextResponse.json(
            { success: true, connected: false, installUrl: null, repos: [] },
            { headers: NO_STORE },
        );
    }

    const connectUrl = installUrl(issueInstallState(userId));

    let accounts: Array<{ installationId: number; accountLogin: string | null }> = [];
    try {
        accounts = await installationsFor(userId);
    } catch (error) {
        console.warn(`[github] could not read installations: ${detail(error)}`);
    }

    const seen = new Set<string>();
    const repos: RepoSummary[] = [];

    for (const account of accounts) {
        try {
            for (const repo of await installationSource(account.installationId).listRepos()) {
                if (seen.has(repo.fullName)) continue;
                seen.add(repo.fullName);
                repos.push(repo);
            }
        } catch (error) {
            if (error instanceof GitHubError && error.failure === "not-found") {
                // GitHub 404s an installation that has been uninstalled on their
                // side. Our row is the stale one, so it goes.
                await removeInstallation(account.installationId);
                forgetInstallationToken(account.installationId);
                continue;
            }
            console.warn(
                `[github] installation ${account.installationId} listed no repositories: ${detail(error)}`,
            );
        }
    }

    repos.sort(byPushedAtDesc);

    return NextResponse.json(
        {
            success: true,
            connected: accounts.length > 0,
            installUrl: connectUrl,
            repos,
        },
        { headers: NO_STORE },
    );
}

function byPushedAtDesc(a: RepoSummary, b: RepoSummary): number {
    if (a.pushedAt === b.pushedAt) return a.fullName.localeCompare(b.fullName);
    if (a.pushedAt === null) return 1;
    if (b.pushedAt === null) return -1;
    return b.pushedAt.localeCompare(a.pushedAt);
}

function detail(error: unknown): string {
    return error instanceof Error ? error.message : "unknown error";
}
