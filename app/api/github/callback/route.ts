import { NextResponse } from "next/server";

import { getApiViewer } from "@/lib/auth/server";
import {
    forgetInstallationToken,
    installationAccount,
    verifyInstallState,
} from "@/lib/github/app";
import { removeInstallation, saveInstallation } from "@/lib/report/store";

/**
 * Where GitHub sends someone after they install or remove the app.
 *
 * This is the only point where an outside origin hands us an identifier we then
 * store against a user, so it is the only point where CSRF matters. The state
 * issued by `/api/github/status` binds the install to one user id and one
 * fifteen minute window, and it is checked before anything is written.
 *
 * Every outcome is a redirect back into the studio with a `github` query
 * parameter, never a JSON error page. Someone who just clicked "Install" on
 * github.com should land in the product, and the product should say what
 * happened.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Outcome = "connected" | "disconnected" | "signin" | "state" | "invalid";

export async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    const installationId = Number(params.get("installation_id"));
    const setupAction = params.get("setup_action");

    const viewer = await getApiViewer();
    const userId = viewer.userId;
    if (userId === null) return back(request, "signin");

    if (!Number.isInteger(installationId) || installationId <= 0) {
        return back(request, "invalid");
    }

    // Checked ahead of the uninstall branch too: a forged link that silently
    // drops someone's connection is still an attack worth closing.
    if (!verifyInstallState(params.get("state"), userId)) {
        return back(request, "state");
    }

    if (setupAction === "delete") {
        await removeInstallation(installationId);
        forgetInstallationToken(installationId);
        return back(request, "disconnected");
    }

    let accountLogin: string | null = null;
    try {
        accountLogin = await installationAccount(installationId);
    } catch (error) {
        // The account name is a label in the repo picker. Losing it is worth a
        // log line, not a failed connection.
        const detail = error instanceof Error ? error.message : "unknown error";
        console.warn(`[github] could not name installation ${installationId}: ${detail}`);
    }

    await saveInstallation(installationId, userId, accountLogin);
    return back(request, "connected");
}

/** Same-origin by construction, so the callback cannot be turned into an open
 * redirect by anything GitHub puts in the query string. */
function back(request: Request, outcome: Outcome): NextResponse {
    return NextResponse.redirect(new URL(`/studio?github=${outcome}`, request.url));
}
