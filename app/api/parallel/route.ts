import { NextResponse } from "next/server";
import { analyzeParallelPotential, quickAnalysis } from "@/lib/parallelAnalyzer";
import { buildParallelGraph, optimizationPriorities } from "@/lib/parallel/graph";

/**
 * Parallel execution analysis for Monad.
 *
 * Reports which of a contract's entrypoints can run concurrently and, where
 * they cannot, exactly which storage slot forces them into a queue.
 */

export async function POST(req: Request) {
    try {
        const { code, contract, mode = "full" } = await req.json();

        if (typeof code !== "string" || code.trim().length === 0) {
            return NextResponse.json({ success: false, error: "Contract source is required" }, { status: 400 });
        }

        if (mode === "quick") {
            return NextResponse.json({ success: true, mode: "quick", analysis: quickAnalysis(code) });
        }

        const startedAt = Date.now();
        const analysis = analyzeParallelPotential(code, typeof contract === "string" ? contract : undefined);
        const graph = buildParallelGraph(analysis);

        return NextResponse.json({
            success: true,
            mode: "full",
            analysis: {
                ...analysis,
                graph,
                priorities: optimizationPriorities(analysis),
                metadata: {
                    analysisTimeMs: Date.now() - startedAt,
                    timestamp: new Date().toISOString(),
                    version: "2.0.0",
                },
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected server error";
        console.error("Parallel analysis error:", error);

        return NextResponse.json(
            {
                success: false,
                error: message,
                details: process.env.NODE_ENV === "development" && error instanceof Error ? error.stack : undefined,
            },
            { status: 500 }
        );
    }
}

export async function GET() {
    return NextResponse.json({
        name: "Monad Parallel Execution Analyzer",
        version: "2.0.0",
        description:
            "Reports which entrypoints of a Solidity contract can execute concurrently under Monad's optimistic parallel scheduler, and which storage slots force serialisation.",
        endpoints: {
            POST: {
                body: {
                    code: "string (required) - Solidity source, flattened files supported",
                    contract: "string (optional) - which contract in the file to profile",
                    mode: "'quick' | 'full' (default 'full')",
                },
            },
        },
        model: {
            unit: "A transaction, meaning one externally callable state-changing function",
            excluded: "view and pure functions, constructors, internal helpers (folded into their callers)",
            score: "Share of concurrent entrypoint pairs, self-pairs included, whose storage footprints do not overlap on a written slot",
            scopes: {
                global: "One slot for every caller. Any two transactions touching it serialise.",
                keyed: "Addressed by a runtime key. Serialises only on equal keys.",
                caller: "Keyed by msg.sender. Distinct senders never collide.",
            },
        },
    });
}
