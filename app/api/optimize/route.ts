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
  The model that rewrites the contract. A rewrite people will deploy is worth
  the strongest model, and a strong model gets it right in one pass, which is
  also what makes it fast. The gates still apply: an edit set that does not
  compile, drops a function or fails to raise the measured score is never shown
  as a win. OPTIMIZER_MODEL takes a comma separated list; several models draft
  in parallel and the best measured draft wins.
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

/**
 * Findings worth a second pass: critical and high only. A second pass for
 * mediums added over a minute for a few points; a critical left behind is
 * worth that minute, a style finding is not.
 */
function serious(report: RepoReport): Finding[] {
    return (report.contracts[0]?.findings ?? []).filter(
        (finding) => finding.severity === "critical" || finding.severity === "high",
    );
}

const MAX_REFINEMENTS = 2;

/**
 * How long the other models get once one draft has passed the gates. Waiting
 * for every model made the slowest one, retries and all, set the pace: most of
 * a two minute optimization was spent waiting on a draft that usually lost.
 */
const DRAFT_GRACE_MS = 15_000;

type Draft = { source: string; changes: OptimizeChange[] };

/** Every draft that is ready by the time the first good one has had company for a moment. */
function firstDrafts(drafts: ReadonlyArray<Promise<Draft | null>>): Promise<Draft[]> {
    return new Promise((resolve) => {
        const ready: Draft[] = [];
        let pending = drafts.length;
        let grace: ReturnType<typeof setTimeout> | undefined;
        const finish = () => {
            if (grace !== undefined) clearTimeout(grace);
            resolve([...ready]);
        };
        for (const draft of drafts) {
            void draft.then((result) => {
                pending -= 1;
                if (result !== null) {
                    ready.push(result);
                    if (grace === undefined && pending > 0) grace = setTimeout(finish, DRAFT_GRACE_MS);
                }
                if (pending === 0) finish();
            });
        }
        if (drafts.length === 0) finish();
    });
}

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

            /**
             * One model's rewrite, gated on compiling and on the interface
             * staying whole.
             *
             * Edits that land are kept. Ones whose quote did not match are sent
             * back once, against the file as it now stands, rather than
             * throwing away the good edits and starting over: cheaper models
             * get most edits right and misquote one or two.
             */
            const rewrite = async (
                model: string,
                source: string,
                findings: readonly Finding[],
            ): Promise<{ source: string; changes: OptimizeChange[] } | null> => {
                const targets = labelled(findings);
                const baseline = await compiles(compilationUnit(path, { ...files, [path]: source }));
                let feedback: string | undefined;

                const draft = async (current: string, note: string | undefined): Promise<Edit[] | null> => {
                    const prompt = buildOptimizePrompt({
                        path,
                        contractName: contract.name,
                        source: current,
                        pragma: pragmaOf(current),
                        findings: targets,
                        contendedSlots: hotspots.filter((hotspot) => hotspot.scope === "global").map((hotspot) => hotspot.variable),
                        expensiveFunctions: gasFunctions,
                        imports,
                        ...(note === undefined ? {} : { feedback: note }),
                    });
                    try {
                        const raw = await callPreferredAI([model], prompt, OPTIMIZER_SYSTEM_ROLE, deadline - 60_000, {
                            // Room to think and still answer: the reasoning
                            // counts against this budget.
                            maxTokens: 32_000,
                            temperature: 0.1,
                            modelTimeoutMs: REWRITE_TIMEOUT_MS,
                            // Reasoning models such as DeepSeek spend the whole
                            // budget thinking without a cap; others answer directly.
                            ...(model.startsWith("deepseek/") ? { reasoningEffort: "low" as const } : {}),
                        });
                        return parseEdits(raw);
                    } catch (error) {
                        console.error(`Optimize: ${model} failed:`, error);
                        return null;
                    }
                };

                for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                    if (Date.now() > deadline - 60_000 || !open) return null;

                    const edits = await draft(source, feedback);
                    if (edits === null) return null;
                    if (edits.length === 0) {
                        feedback = "Your reply contained no <edit> blocks. Reply only with edits in the required shape.";
                        continue;
                    }
                    const first = applyEdits(source, edits);
                    if (first.applied.length === 0) {
                        feedback = `None of your edits could be applied:\n${describeRejections(first.rejected)}\nQuote the file exactly.`;
                        continue;
                    }

                    let candidate = first.source;
                    let applied = first.applied;
                    if (first.rejected.length > 0 && Date.now() < deadline - 90_000) {
                        const repairs = await draft(
                            candidate,
                            `Your other edits are already applied in the file below. These did not apply:\n${describeRejections(first.rejected)}\nSend only corrected versions of these edits, quoting the file below exactly.`,
                        );
                        if (repairs !== null && repairs.length > 0) {
                            const second = applyEdits(candidate, repairs);
                            candidate = second.source;
                            applied = [...applied, ...second.applied];
                        }
                    }

                    const compatibility = checkCompatibility(source, candidate, contract.name);
                    if (!compatibility.compatible) {
                        feedback = describeIncompatibility(compatibility);
                        continue;
                    }
                    if (baseline.ok) {
                        const built = await compiles(compilationUnit(path, { ...files, [path]: candidate }));
                        if (!built.ok) {
                            feedback = `The edited file does not compile. The compiler said:\n${built.error.slice(0, 1500)}`;
                            continue;
                        }
                    }
                    return { source: candidate, changes: changesFrom(applied, targets) };
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
                        ...(contract.threats !== undefined ? { threats: contract.threats } : {}),
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

            type Measured = { source: string; changes: OptimizeChange[]; report: RepoReport };

            /*
              One pass: every model drafts in parallel, every draft that passes
              the gates is measured in parallel, and the highest score wins.
              Two cheap models disagree often enough that picking the better
              of two measured results beats trusting either one.
            */
            const pass = async (
                stage: "rewriting" | "refining",
                from: { source: string; findings: readonly Finding[] },
                targets: readonly Finding[],
            ): Promise<Measured | null> => {
                send({
                    type: "stage",
                    stage,
                    label:
                        OPTIMIZER_MODELS.length > 1
                            ? `${OPTIMIZER_MODELS.length} models drafting fixes for ${targets.length} ${targets.length === 1 ? "finding" : "findings"}`
                            : `Drafting fixes for ${targets.length} ${targets.length === 1 ? "finding" : "findings"}`,
                });
                const valid = await firstDrafts(
                    OPTIMIZER_MODELS.map((model) =>
                        rewrite(model, from.source, targets).catch((error: unknown) => {
                            console.error(`Optimize: ${model} draft failed:`, error);
                            return null;
                        }),
                    ),
                );
                const unique = valid.filter((draft, index) => valid.findIndex((other) => other.source === draft.source) === index);
                if (unique.length === 0) return null;

                send({ type: "stage", stage: "compiling", label: `${unique.length} ${unique.length === 1 ? "version compiles" : "versions compile"} with every public function intact` });
                const measured = await Promise.all(
                    unique.map(async (draft) => {
                        const report = await measure(draft.source, from);
                        return report === null ? null : { ...draft, report };
                    }),
                );
                return measured
                    .filter((entry): entry is Measured => entry !== null)
                    .reduce<Measured | null>((top, entry) => (top === null || scoreOf(entry.report) > scoreOf(top.report) ? entry : top), null);
            };

            try {
                const first = await pass("rewriting", { source: original, findings: contract.findings }, contract.findings);
                if (first === null) {
                    send({ type: "error", message: "The optimizer could not produce a version that compiles and keeps the contract's interface. Nothing was changed or charged." });
                    return;
                }
                let best: Measured = first;

                /*
                  Refinement, while there is time and something above
                  informational is left. Each pass starts from the best code so
                  far and sees the latest report's findings, which is how a fix
                  that exposed something new, or missed a medium, gets another
                  look. A pass is kept only if the report scores it higher, so
                  refining can never make the result worse.
                */
                for (let round = 0; round < MAX_REFINEMENTS; round++) {
                    const left = serious(best.report);
                    if (left.length === 0 || deadline - Date.now() < REFINE_RESERVE_MS + 60_000) break;
                    const next = await pass(
                        "refining",
                        { source: best.source, findings: best.report.contracts[0]?.findings ?? [] },
                        left,
                    );
                    if (next === null || scoreOf(next.report) <= scoreOf(best.report)) break;
                    best = { source: next.source, changes: [...best.changes, ...next.changes], report: next.report };
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
