import { after, NextResponse } from "next/server";

import { forgetInstallationToken } from "@/lib/github/app";
import { handlePullRequest } from "@/lib/prReview/run";
import { recordInstall, recordSuspension, recordUninstall } from "@/lib/prReview/store";
import { parseEvent, shouldReview, verifySignature } from "@/lib/prReview/webhook";
import { claimWebhook } from "@/lib/report/store";

/**
 * GitHub's deliveries for the Monsmith app.
 *
 * GitHub gives a delivery ten seconds before it marks it failed, and a review
 * takes a minute or more, so the delivery is acknowledged as soon as it is
 * verified and claimed, and the review runs after the response under this
 * route's own time limit.
 *
 * Nothing is read from the body until the signature over the raw bytes checks
 * out. A delivery id is claimed once, because GitHub redelivers and a second
 * review of the same push would spend the same model credits twice.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
    const secret = process.env.GITHUB_APP_WEBHOOK_SECRET ?? "";
    if (secret.length === 0) {
        return NextResponse.json({ error: "Webhooks are not set up on this deployment." }, { status: 503 });
    }

    const body = await request.text();
    if (!verifySignature(secret, body, request.headers.get("x-hub-signature-256"))) {
        return NextResponse.json({ error: "Bad signature." }, { status: 401 });
    }

    let payload: unknown;
    try {
        payload = JSON.parse(body) as unknown;
    } catch {
        return NextResponse.json({ error: "Body is not JSON." }, { status: 400 });
    }

    const name = request.headers.get("x-github-event");
    const event = parseEvent(name, payload);
    if (event.kind === "ignored") return NextResponse.json({ ignored: event.reason });

    const delivery = request.headers.get("x-github-delivery");
    if (delivery !== null && !(await claimWebhook(`github:${delivery}`, `github.${name ?? "unknown"}`))) {
        return NextResponse.json({ duplicate: true });
    }

    if (event.kind === "installation") {
        if (event.action === "created") await recordInstall(event.installationId, event.account, event.accountType);
        if (event.action === "deleted") {
            await recordUninstall(event.installationId);
            forgetInstallationToken(event.installationId);
        }
        if (event.action === "suspend" || event.action === "unsuspend") {
            await recordSuspension(event.installationId, event.action === "suspend");
        }
        return NextResponse.json({ ok: true });
    }

    if (event.action !== "closed" && !shouldReview(event)) return NextResponse.json({ ignored: "draft" });

    after(async () => {
        try {
            await handlePullRequest(event);
        } catch (error) {
            console.error(`[pr-review] handling ${event.repo.fullName}#${event.pull.number} failed:`, error);
        }
    });
    return NextResponse.json({ accepted: true }, { status: 202 });
}
