import { NextResponse } from "next/server";

import { getApiViewer } from "@/lib/auth/server";
import { githubAppConfigured, installUrl, issueInstallState } from "@/lib/github/app";
import { isRecord, isRepoName } from "@/lib/github/client";
import { installationSource } from "@/lib/github/installationSource";
import { publicSource } from "@/lib/github/publicSource";
import {
    GitHubError,
    isInterfaceOnly,
    parseRepoInput,
    type GitHubFailure,
    type ImportResult,
    type RepoRef,
} from "@/lib/github/source";
import { installationsFor } from "@/lib/report/store";

/**
 * Pulls a repository's Solidity into a workspace.
 *
 * The source is chosen rather than configured. A public read is tried first
 * because it is one request cheaper, needs no install and works for a
 * signed-out visitor, and only "this account cannot see it" is worth a second,
 * authenticated attempt. A repository with no Solidity in it has none either
 * way, so that failure is returned immediately instead of being retried against
 * every installation the viewer holds.
 *
 * When every attempt comes back as "cannot see it", the response carries the
 * install URL. That is the moment the GitHub App is actually worth explaining,
 * and offering it inline is what keeps the connect step from becoming a
 * prerequisite nobody asked for.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

const STATUS: Record<GitHubFailure, number> = {
    "not-found": 404,
    "needs-auth": 401,
    "rate-limited": 429,
    "no-solidity": 422,
    "too-large": 413,
    unavailable: 502,
};

export async function POST(request: Request) {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return bad("Send a JSON body naming a repository.");
    }
    if (!isRecord(body)) return bad("Send a JSON body naming a repository.");

    const requested = readRef(body);
    if ("error" in requested) return bad(requested.error);

    const viewer = await getApiViewer();
    const userId = viewer.userId;

    let result: ImportResult;
    try {
        result = await importSolidity(requested, userId);
    } catch (error) {
        return failed(error, userId);
    }

    const files: Record<string, string> = {};
    for (const file of result.files) files[file.path] = file.content;

    return NextResponse.json(
        {
            success: true,
            ref: result.ref,
            private: result.private,
            files,
            skipped: result.skipped,
            truncated: result.truncated,
            counts: {
                // Every path the tree offered that ended in .sol, imported or not,
                // so the UI can say "12 of 40" rather than just "12".
                solidity: result.files.length + result.skipped.length,
                auditable: result.files.filter((file) => !isInterfaceOnly(file.content)).length,
            },
        },
        { headers: NO_STORE },
    );
}

// ============= SOURCE SELECTION =============

async function importSolidity(ref: RepoRef, userId: string | null): Promise<ImportResult> {
    let unseen: unknown;
    try {
        return await publicSource.importSolidity(ref);
    } catch (error) {
        if (!isVisibilityFailure(error)) throw error;
        unseen = error;
    }

    if (userId === null || !githubAppConfigured()) throw unseen;

    let accounts: Array<{ installationId: number }> = [];
    try {
        accounts = await installationsFor(userId);
    } catch (error) {
        const detail = error instanceof Error ? error.message : "unknown error";
        console.warn(`[github] could not read installations: ${detail}`);
    }

    for (const account of accounts) {
        try {
            return await installationSource(account.installationId).importSolidity(ref);
        } catch (error) {
            // This installation cannot see the repository, but the next one may.
            if (isVisibilityFailure(error)) continue;
            throw error;
        }
    }

    throw unseen;
}

function isVisibilityFailure(error: unknown): boolean {
    return (
        error instanceof GitHubError &&
        (error.failure === "not-found" || error.failure === "needs-auth")
    );
}

// ============= REQUEST PARSING =============

function readRef(body: Record<string, unknown>): RepoRef | { error: string } {
    const url = str(body.url);

    let base: RepoRef;
    if (url !== null) {
        const parsed = parseRepoInput(url);
        if (parsed === null) {
            return { error: `"${url}" is not a GitHub repository. Paste a repository URL, or owner/repo.` };
        }
        base = parsed;
    } else {
        const owner = str(body.owner);
        const repo = str(body.repo);
        if (owner === null || repo === null) {
            return { error: "A repository URL, or an owner and a repo, is required." };
        }
        base = { owner, repo };
    }

    if (!isRepoName(base.owner) || !isRepoName(base.repo)) {
        return { error: `"${base.owner}/${base.repo}" is not a GitHub repository name.` };
    }

    // Explicit fields win over anything the pasted URL implied, so a picker can
    // send a repo URL and a branch without having to rewrite the URL first.
    const ref = str(body.ref) ?? base.ref;
    const subdir = str(body.subdir) ?? base.subdir;

    return {
        owner: base.owner,
        repo: base.repo,
        ...(ref !== undefined ? { ref } : {}),
        ...(subdir !== undefined ? { subdir } : {}),
    };
}

function str(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// ============= FAILURES =============

function bad(message: string): NextResponse {
    return NextResponse.json({ success: false, error: message }, { status: 400, headers: NO_STORE });
}

function failed(error: unknown, userId: string | null): NextResponse {
    if (!(error instanceof GitHubError)) {
        const detail = error instanceof Error ? error.message : "unknown error";
        console.error(`[github] import failed: ${detail}`);
        return NextResponse.json(
            { success: false, error: "The import could not be completed.", failure: "unavailable" },
            { status: 500, headers: NO_STORE },
        );
    }

    const payload: Record<string, unknown> = {
        success: false,
        error: error.message,
        failure: error.failure,
    };

    // A private repository is a 404 to an unauthorised reader, so both failures
    // are answered with the way out rather than only the one that names itself.
    if (error.failure === "needs-auth" || error.failure === "not-found") {
        payload.installUrl = userId !== null ? installUrl(issueInstallState(userId)) : null;
    }

    return NextResponse.json(payload, { status: STATUS[error.failure], headers: NO_STORE });
}
