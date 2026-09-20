import { NextResponse } from "next/server";

import { getApiViewer } from "@/lib/auth/server";
import { buildRepoReport } from "@/lib/report/build";
import { redactReport } from "@/lib/report/redact";
import { isUnlocked, saveReport, type ReportOwner } from "@/lib/report/store";
import { paywallEnabled } from "@/lib/report/entitlement";
import { CONTRACT_CAP, type ReportEvent, type ReportOrigin } from "@/lib/report/types";

/**
 * The Contract Report, streamed.
 *
 * Running every analysis over every contract in a repository is minutes of solc
 * and local EVM time, which is more than any single response can hold open and
 * far more than a user will stare at a spinner for. So this is server-sent
 * events: the rail renders each section the moment it lands, and a report that
 * is still measuring its twelfth contract has already shown the first eleven.
 *
 * Two things are load-bearing and easy to get wrong.
 *
 * The full report is written to the database and then redacted before it is
 * serialised, so the paid half never reaches the browser of someone who has not
 * unlocked it. A paywall applied in the client is not a paywall, and this
 * audience opens dev tools by reflex.
 *
 * Persistence runs before entitlement is resolved, because the first report an
 * account produces is free and `isUnlocked` decides that by looking for the
 * earliest row belonging to the owner. Ask before writing and the first report
 * is never the first one.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

interface ReportBody {
    files?: unknown;
    origin?: unknown;
    chains?: unknown;
    visitorId?: unknown;
}

/** Path to source, rejecting anything that is not both strings. */
function readFiles(value: unknown): Record<string, string> | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

    const files: Record<string, string> = {};
    for (const [path, content] of Object.entries(value)) {
        if (typeof content !== "string") return null;
        files[path] = content;
    }
    return files;
}

/**
 * Narrows the provenance line.
 *
 * An origin nobody can vouch for is worse than no origin: it ends up printed on
 * a shared report as if it were checked. Anything unrecognised falls back to the
 * workspace, which claims nothing.
 */
function readOrigin(value: unknown): ReportOrigin {
    if (typeof value !== "object" || value === null) return { kind: "workspace" };
    const origin = value as Record<string, unknown>;

    if (
        origin.kind === "address" &&
        typeof origin.address === "string" &&
        typeof origin.chainId === "number"
    ) {
        return { kind: "address", address: origin.address, chainId: origin.chainId };
    }

    if (
        origin.kind === "github" &&
        typeof origin.owner === "string" &&
        typeof origin.repo === "string" &&
        typeof origin.ref === "string"
    ) {
        return {
            kind: "github",
            owner: origin.owner,
            repo: origin.repo,
            ref: origin.ref,
            private: origin.private === true,
        };
    }

    return { kind: "workspace" };
}

function readChains(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value.filter((entry): entry is string => typeof entry === "string");
}

export async function POST(request: Request) {
    let body: ReportBody;
    try {
        body = (await request.json()) as ReportBody;
    } catch {
        return NextResponse.json({ success: false, error: "Request body must be JSON" }, { status: 400 });
    }

    const files = readFiles(body.files);
    if (files === null) {
        return NextResponse.json(
            { success: false, error: "files must be a map of path to source" },
            { status: 400 },
        );
    }

    const viewer = await getApiViewer();
    const owner: ReportOwner = {
        userId: viewer.userId,
        // Same anonymous id the analytics beacon sends, so a signed-out visitor
        // keeps their own reports across a session.
        visitorId: typeof body.visitorId === "string" ? body.visitorId.slice(0, 100) : null,
    };
    const unlimited = viewer.permissions.includes("analysis.unlimited");

    const encoder = new TextEncoder();
    let open = true;

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const send = (event: ReportEvent): void => {
                if (!open) return;
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                } catch {
                    // The consumer went away mid-report. Stop writing rather
                    // than turning a closed pipe into a failed report.
                    open = false;
                }
            };

            try {
                for await (const event of buildRepoReport({
                    files,
                    origin: readOrigin(body.origin),
                    cap: CONTRACT_CAP[viewer.tier],
                    chains: readChains(body.chains),
                })) {
                    // Breaking out of the loop closes the generator, which stops
                    // the work rather than leaving it to finish into nothing.
                    if (!open || request.signal.aborted) break;

                    if (event.type !== "complete") {
                        send(event);
                        continue;
                    }

                    const report = event.report;
                    try {
                        await saveReport(report, owner);
                    } catch (error) {
                        // A report that cannot be persisted is still a report.
                        // It loses its permalink, not its contents.
                        console.error("Report persistence failed:", error);
                    }

                    // The paywall is dormant, so this resolves to true until
                    // the flag is switched on. The call still happens rather
                    // than being skipped, so the path stays exercised.
                    let entitled = !paywallEnabled() || unlimited;
                    try {
                        if (paywallEnabled()) {
                            entitled = await isUnlocked(report.reportId, owner, unlimited);
                        }
                    } catch (error) {
                        // Falling back to the tier is the safe direction: a
                        // database that cannot answer must not hand out the
                        // paid half on a guess.
                        console.error("Entitlement check failed:", error);
                    }

                    send({ type: "complete", report: redactReport(report, entitled) });
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : "Report generation failed";
                console.error("Report generation error:", error);
                send({ type: "error", message });
            } finally {
                if (open) {
                    open = false;
                    try {
                        controller.close();
                    } catch {
                        // Already closed by a cancelled consumer.
                    }
                }
            }
        },
        cancel() {
            open = false;
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            // Without this a proxy buffers the whole stream and the progressive
            // rendering this endpoint exists for never happens.
            "X-Accel-Buffering": "no",
        },
    });
}

export async function GET() {
    return NextResponse.json({
        name: "Monsmith Contract Report",
        description:
            "Runs every analysis the product offers over every auditable contract in a workspace, and streams the results as they land.",
        method: "POST",
        response: "text/event-stream, one JSON ReportEvent per `data:` frame",
        body: {
            files: "Record<string, string> (required) - workspace path to Solidity source",
            origin: "ReportOrigin (optional) - workspace, address or github. Defaults to workspace.",
            chains: "string[] (optional) - chain ids for the chain fit comparison",
            visitorId: "string (optional) - anonymous id, so a signed-out report has an owner",
        },
        events: {
            started: "{ reportId, planned, skipped } - what will be audited and what will not",
            section: "{ contractId, section, result } - one of four analyses, as it completes",
            contract: "{ contract } - the assembled report for one contract",
            progress: "{ done, total, label }",
            complete: "{ report } - the whole report, redacted unless the viewer is entitled",
            error: "{ message }",
        },
        limits: {
            contracts: CONTRACT_CAP,
            perContractBudgetMs: 25_000,
            note: "Tests, scripts, dependencies and interface-only sources are never audited.",
        },
    });
}
