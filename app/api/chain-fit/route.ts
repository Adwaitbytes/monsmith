import { NextResponse } from "next/server";

import { isChainId, type ChainId } from "@/lib/chainfit/chains";
import { buildChainFitReport } from "@/lib/chainfit/report";

/**
 * Chain Fit API
 *
 * Compiles a contract, executes it in a local EVM, and reports what it costs
 * and how it behaves on each chain in the comparison. The heavy work is solc
 * and a full EVM run, so this needs the Node runtime and a generous timeout.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as { code?: string; chains?: unknown };
        const code = body.code;

        if (typeof code !== "string" || code.trim().length === 0) {
            return NextResponse.json(
                { success: false, error: "Contract source is required" },
                { status: 400 },
            );
        }

        // An unknown chain id is a caller mistake worth reporting, rather than
        // something to silently drop and then answer with a smaller comparison.
        let chains: ChainId[] | undefined;
        if (Array.isArray(body.chains)) {
            const requested = body.chains.filter((id): id is string => typeof id === "string");
            const unknown = requested.filter((id) => !isChainId(id));
            if (unknown.length > 0) {
                return NextResponse.json(
                    { success: false, error: `Unknown chains: ${unknown.join(", ")}` },
                    { status: 400 },
                );
            }
            if (requested.length > 0) chains = requested.filter(isChainId);
        }

        const startedAt = Date.now();
        const report = await buildChainFitReport({ source: code, chains });

        return NextResponse.json({
            success: true,
            report,
            metadata: {
                analysisTimeMs: Date.now() - startedAt,
                timestamp: new Date().toISOString(),
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected server error";
        console.error("Chain Fit analysis error:", error);
        // A compile failure is the caller's input, not a server fault, and the
        // studio shows the message verbatim so it has to stay readable.
        const isCompileError = /^Compilation failed|ParserError|DeclarationError|TypeError:/.test(
            message,
        );
        return NextResponse.json(
            { success: false, error: message },
            { status: isCompileError ? 400 : 500 },
        );
    }
}

export async function GET() {
    return NextResponse.json({
        name: "Monsmith Chain Fit",
        description:
            "Compiles a contract, runs it in a local EVM, and reprices the execution under each chain's published gas schedule.",
        method: "POST",
        body: {
            code: "string (required) - Solidity source",
            chains: "string[] (optional) - chain ids to compare, defaults to the full set",
        },
        method_notes: [
            "Ethereum gas is measured from a real EVM execution.",
            "Monad gas is that measurement adjusted by the MIP-8 schedule: cold state access, 128-slot storage pages, repriced precompiles and linear memory.",
            "Block time, block gas limit and gas price are probed live from each chain's public RPC.",
        ],
    });
}
