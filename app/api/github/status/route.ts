import { NextResponse } from "next/server";

import { getApiViewer } from "@/lib/auth/server";
import { githubAppConfigured, installUrl, issueInstallState } from "@/lib/github/app";
import { installationsFor } from "@/lib/report/store";

/**
 * Whether this viewer can reach private repositories, and how to start if not.
 *
 * The studio calls this before it renders the import panel, so it must answer
 * for every deployment shape: no GitHub App, no database, nobody signed in. All
 * three are ordinary states rather than errors, and each one resolves to
 * `configured: false`, which the panel reads as "the public paste path is all
 * there is right now".
 *
 * The install URL is issued here rather than hardcoded in the client because it
 * carries a signed, single-user CSRF state that only the server can mint.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export async function GET() {
    const viewer = await getApiViewer();
    const userId = viewer.userId;

    // An install has to be bound to an account, so a signed-out viewer has no
    // connect flow available to them even on a fully configured deployment.
    if (!githubAppConfigured() || userId === null) {
        return NextResponse.json(
            { configured: false, connected: false, installUrl: null, accounts: [] },
            { headers: NO_STORE },
        );
    }

    let accounts: Array<{ installationId: number; accountLogin: string | null }> = [];
    try {
        accounts = await installationsFor(userId);
    } catch (error) {
        // Losing the installation list downgrades the viewer to the public path,
        // which is a worse product but a working one.
        console.warn(`[github] could not read installations: ${reason(error)}`);
    }

    return NextResponse.json(
        {
            configured: true,
            connected: accounts.length > 0,
            installUrl: installUrl(issueInstallState(userId)),
            accounts,
        },
        { headers: NO_STORE },
    );
}

function reason(error: unknown): string {
    return error instanceof Error ? error.message : "unknown error";
}
