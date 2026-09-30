import { NextResponse } from "next/server";

import { callPreferredAI, hasAIProvider, MISSING_PROVIDER_MESSAGE } from "@/lib/aiClient";
import { getApiViewer } from "@/lib/auth/server";
import { isReportId } from "@/lib/billing/reportPayments";
import { flattenImportClosure, importClosure } from "@/lib/flatten";
import { decideOptimize, FREE_OPTIMIZATIONS } from "@/lib/optimize/allowance";
import {
    applyEdits,
    buildOptimizePrompt,
    describeRejections,
    diffLines,
    lineDelta,
    OPTIMIZER_SYSTEM_ROLE,
    parseEdits,
    pragmaOf,
    type Edit,
} from "@/lib/optimize/engine";
import { snapshotOf, type OptimizeChange, type OptimizeEvent, type OptimizeResult } from "@/lib/optimize/types";
import { checkCompatibility, describeIncompatibility } from "@/lib/parallel/compatibility";
import { LIMITS, rateLimit, tooManyRequests } from "@/lib/rateLimit";
import { buildRepoReport } from "@/lib/report/build";
import { paywallEnabled, resolveOwner } from "@/lib/report/entitlement";
import {
    freeOptimizationsUsed,
    loadReport,
    recordOptimization,
    reportWasPaidFor,
    type StoredReport,
} from "@/lib/report/store";
import type { ContractReport, Finding, RepoReport } from "@/lib/report/types";
import { compileVersioned } from "@/lib/solc/compile";

/**
 * Optimizing a contract, proved rather than promised.
 *
 * A strong model proposes edits against the audit's own findings. The result
 * only counts if it compiles with the contract's own compiler, keeps every
 * external function and event, and then scores higher when the full report is
 * run on it again. That last step is the point: the score the reader sees
 * afterwards is measured by the same pipeline as the one before, not claimed.
 *
 * An optimization that does not raise the score is still shown, honestly, and
 * is not counted against the free allowance.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const BUDGET_MS = 285_000;
const REWRITE_TIMEOUT_MS = 110_000;
/** Enough for one report plus a margin; below it a refinement is not started. */
const REFINE_RESERVE_MS = 120_000;
const MAX_ATTEMPTS = 3;
const MAX_FILE_CHARS = 120_000;

/*
  The default chain is tuned for fast chat. Rewriting a contract someone will
  deploy is worth the strongest model available, so it is named here and the
  default chain is only the fallback.
*/
const OPTIMIZER_MODELS = (process.env.OPTIMIZER_MODEL ?? "anthropic/claude-sonnet-5.5")
    .split(",")
    .map((model) => model.trim())
    .filter((model) => model.length > 0);

interface OptimizeBody {
    reportId?: unknown;
    path?: unknown;
    files?: unknown;
}

function readFiles(value: unknown): Record<string, string> | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const files: Record<string, string> = {};
    for (const [path, content] of Object.entries(value)) {
        if (typeof content !== "string") return null;
        files[path] = content;
    }
    return files;
}

async function compiles(unit: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
        await compileVersioned(unit, { outputs: ["abi"] });
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

function compilationUnit(path: string, files: Record<string, string>): string {
    return flattenImportClosure(path, files) ?? files[path];
}

/*
  Report finding ids are long paths the model does not echo back reliably, so
  each pass hands it short labels (F1, F2, ...) and maps its answers back.
*/
function labelled(findings: readonly Finding[]): Finding[] {
    return findings.map((finding, index) => ({ ...finding, id: `F${index + 1}` }));
}

function changesFrom(edits: readonly Edit[], findings: readonly Finding[]): OptimizeChange[] {
    const byLabel = new Map(findings.map((finding) => [finding.id, finding.title]));
    return edits.map((edit) => ({
        title: edit.title,
        why: edit.why,
        fixes: [...new Set(edit.fixes.map((label) => byLabel.get(label.toUpperCase())).filter((title): title is string => title !== undefined))],
    }));
}

/** Findings still worth another pass: anything above informational. */
function serious(report: RepoReport): Finding[] {
    return (report.contracts[0]?.findings ?? []).filter((finding) => finding.severity !== "info");
}

const MAX_REFINEMENTS = 2;

function jsonError(message: string, status: number, reason?: "sign-in" | "pay") {
    return NextResponse.json({ success: false, error: message, ...(reason === undefined ? {} : { reason }) }, { status });
}

export async function POST(req: Request) {
    let body: OptimizeBody;
    try {
        body = (await req.json()) as OptimizeBody;
    } catch {
        return jsonError("Request body must be JSON.", 400);
    }

    const reportId = typeof body.reportId === "string" ? body.reportId : "";
    const path = typeof body.path === "string" ? body.path : "";
    const files = readFiles(body.files);
    if (!isReportId(reportId)) return jsonError("That is not a report id.", 400);
    if (files === null || path.length === 0 || files[path] === undefined) {
        return jsonError("Send the workspace files, including the contract to optimize.", 400);
    }
    if (files[path].length > MAX_FILE_CHARS) {
        return jsonError(`This file is ${Math.round(files[path].length / 1000)}KB. Optimization runs on files up to ${MAX_FILE_CHARS / 1000}KB.`, 413);
    }
    if (!hasAIProvider()) return jsonError(MISSING_PROVIDER_MESSAGE, 503);

    const viewer = await getApiViewer();
    const budget = await rateLimit(req, LIMITS.optimize, viewer.userId);
    if (!budget.ok) return tooManyRequests(budget, "optimizations");

    let stored: StoredReport | null;
    try {
        stored = await loadReport(reportId);
    } catch (error) {
        console.error(`Optimize: could not read report ${reportId}:`, error);
        return jsonError("Could not read the report store.", 503);
    }
    if (stored === null) return jsonError("Report not found.", 404);

    // The findings come from the stored report, never from the request, so a
    // caller cannot steer the rewrite with findings the audit did not make.
    const contract: ContractReport | undefined = stored.report.contracts.find((entry) => entry.path === path);
    if (contract === undefined) return jsonError("Run the report on this contract before optimizing it.", 400);

    const owner = await resolveOwner(req);
    const decision = decideOptimize({
        paywall: paywallEnabled(),
        signedIn: viewer.userId !== null,
        unlimited: viewer.permissions.includes("analysis.unlimited"),
        freeUsed: viewer.userId === null ? 0 : await freeOptimizationsUsed(viewer.userId),
        freeAllowance: FREE_OPTIMIZATIONS,
        reportPaid: await reportWasPaidFor(reportId),
    });
    if (!decision.allowed) return jsonError(decision.message, decision.reason === "sign-in" ? 401 : 402, decision.reason);

    const original = files[path];
    const closure = importClosure(path, files);
    const imports = [...closure.entries()]
        .filter(([file]) => file !== path)
        .map(([file, source]) => ({ path: file, source }));
    const gasFunctions = contract.sections.gas.status === "ok" ? contract.sections.gas.data?.functions ?? [] : [];
    const hotspots = contract.sections.parallel.status === "ok" ? contract.sections.parallel.data?.hotspots ?? [] : [];

    const encoder = new TextEncoder();
    let open = true;
    const deadline = Date.now() + BUDGET_MS;

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const send = (event: OptimizeEvent): void => {
                if (!open) return;
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                } catch {
                    open = false;
                }
            };

            /** One rewrite, gated on compiling and on the interface staying whole. */
            const rewrite = async (
                source: string,
                findings: readonly Finding[],
                stage: "rewriting" | "refining",
            ): Promise<{ source: string; changes: OptimizeChange[] } | null> => {
                const targets = labelled(findings);
                const baseline = await compiles(compilationUnit(path, { ...files, [path]: source }));
                let feedback: string | undefined;

                for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                    if (Date.now() > deadline - 60_000 || !open) return null;
                    send({
                        type: "stage",
                        stage,
                        label:
                            attempt === 1
                                ? `Working through ${findings.length} ${findings.length === 1 ? "finding" : "findings"}`
                                : `The last draft did not pass, so correcting it (attempt ${attempt})`,
                    });

                    const prompt = buildOptimizePrompt({
                        path,
                        contractName: contract.name,
                        source,
                        pragma: pragmaOf(source),
                        findings: targets,
                        contendedSlots: hotspots.filter((hotspot) => hotspot.scope === "global").map((hotspot) => hotspot.variable),
                        expensiveFunctions: gasFunctions,
                        imports,
                        ...(feedback === undefined ? {} : { feedback }),
                    });

                    let raw: string;
                    try {
                        raw = await callPreferredAI(OPTIMIZER_MODELS, prompt, OPTIMIZER_SYSTEM_ROLE, deadline - 60_000, {
                            maxTokens: 16_000,
                            temperature: 0.1,
                            modelTimeoutMs: REWRITE_TIMEOUT_MS,
                        });
                    } catch (error) {
                        console.error("Optimize: the model call failed:", error);
                        return null;
                    }

                    const edits = parseEdits(raw);
                    if (edits.length === 0) {
                        feedback = "Your reply contained no <edit> blocks. Reply only with edits in the required shape.";
                        continue;
                    }
                    const applied = applyEdits(source, edits);
                    if (applied.applied.length === 0) {
                        feedback = `None of your edits could be applied:\n${describeRejections(applied.rejected)}\nQuote the file exactly.`;
                        continue;
                    }
                    // Some edits missing on the last attempt is better than none.
                    if (applied.rejected.length > 0 && attempt < MAX_ATTEMPTS) {
                        feedback = `Some edits could not be applied:\n${describeRejections(applied.rejected)}\nSend the complete set of edits again, quoting the original file exactly.`;
                        continue;
                    }

                    send({ type: "stage", stage: "compiling", label: "Compiling and checking the interface" });
                    const compatibility = checkCompatibility(source, applied.source, contract.name);
                    if (!compatibility.compatible) {
                        feedback = describeIncompatibility(compatibility);
                        continue;
                    }
                    if (baseline.ok) {
                        const built = await compiles(compilationUnit(path, { ...files, [path]: applied.source }));
                        if (!built.ok) {
                            feedback = `The edited file does not compile. The compiler said:\n${built.error.slice(0, 1500)}`;
                            continue;
                        }
                    }
                    return { source: applied.source, changes: changesFrom(applied.applied, targets) };
                }
                return null;
            };

            /**
             * Runs the full report on a version of the contract, auditing it as
             * a fix review of the version it came from.
             */
            const measure = async (
                source: string,
                from: { source: string; findings: readonly Finding[] },
            ): Promise<RepoReport | null> => {
                send({ type: "stage", stage: "reporting", label: "Re-running the full report on the new code" });
                let final: RepoReport | null = null;
                for await (const event of buildRepoReport({
                    files: { ...files, [path]: source },
                    origin: stored.report.origin,
                    cap: 1,
                    only: [path],
                    fixReview: {
                        path,
                        prior: from.findings.filter((finding) => finding.source === "ai"),
                        changedLines: diffLines(from.source, source).changed,
                    },
                })) {
                    if (!open || req.signal.aborted) return null;
                    if (event.type === "progress") send({ type: "progress", done: event.done, total: event.total, label: event.label });
                    if (event.type === "complete") final = event.report;
                    if (event.type === "error") throw new Error(event.message);
                }
                return final;
            };

            const scoreOf = (report: RepoReport | null): number => report?.contracts[0]?.health?.score ?? -1;

            try {
                const first = await rewrite(original, contract.findings, "rewriting");
                if (first === null) {
                    send({ type: "error", message: "The optimizer could not produce a version that compiles and keeps the contract's interface. Nothing was changed or charged." });
                    return;
                }

                const firstReport = await measure(first.source, { source: original, findings: contract.findings });
                if (firstReport === null) throw new Error("The report on the optimized contract did not finish.");
                let best: { source: string; changes: OptimizeChange[]; report: RepoReport } = {
                    source: first.source,
                    changes: first.changes,
                    report: firstReport,
                };

                /*
                  Refinement, while there is time and something above
                  informational is left. Each pass starts from the best code so
                  far and sees the latest report's findings, which is how a fix
                  that exposed something new, or missed a medium, gets another
                  look. A pass is kept only if the report scores it higher, so
                  refining can never make the result worse.
                */
                for (let pass = 0; pass < MAX_REFINEMENTS; pass++) {
                    const left = serious(best.report);
                    if (left.length === 0 || deadline - Date.now() < REFINE_RESERVE_MS + 60_000) break;
                    const next = await rewrite(best.source, left, "refining");
                    if (next === null) break;
                    const report = await measure(next.source, {
                        source: best.source,
                        findings: best.report.contracts[0]?.findings ?? [],
                    });
                    if (report === null || scoreOf(report) <= scoreOf(best.report)) break;
                    best = { source: next.source, changes: [...best.changes, ...next.changes], report };
                }

                const optimizedContract = best.report.contracts[0];
                if (optimizedContract === undefined) throw new Error("The optimized contract was not measured.");

                const before = snapshotOf(contract);
                const after = snapshotOf(optimizedContract);
                const improved = (after.score ?? -1) > (before.score ?? -1);

                send({ type: "stage", stage: "saving", label: "Saving the new report" });
                const free = improved && decision.free;
                if (improved) {
                    await recordOptimization({
                        reportId,
                        optimizedReport: best.report,
                        owner,
                        free,
                        beforeScore: before.score,
                        afterScore: after.score,
                    });
                }

                const result: OptimizeResult = {
                    reportId: best.report.reportId,
                    path,
                    original,
                    optimized: best.source,
                    changes: best.changes,
                    before,
                    after,
                    lines: lineDelta(original, best.source),
                    improved,
                    free,
                };
                send({ type: "done", result });
            } catch (error) {
                console.error("Optimize failed:", error);
                send({ type: "error", message: "The optimization stopped before it finished. Nothing was charged. Try again in a moment." });
            } finally {
                open = false;
                try {
                    controller.close();
                } catch {
                    // Already closed by a departed client.
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
        },
    });
}
