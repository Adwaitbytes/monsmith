import { NextResponse } from "next/server";

import { isChainId, type ChainId } from "@/lib/chainfit/chains";
import { buildChainFitReport } from "@/lib/chainfit/report";
import { fetchVerified, reproduceBuild, NotVerifiedError } from "@/lib/chainfit/sourcify";

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
        const body = (await req.json()) as {
            code?: string;
            chains?: unknown;
            address?: unknown;
            chainId?: unknown;
        };

        // Two ways in. An address is the stronger one: it needs no source, no
        // flattening and no guess about the compiler, and it lets the report say
        // whether what it measured is what is deployed.
        let code = body.code;
        let onchain:
            | { address: string; chainId: number; reproduction: Awaited<ReturnType<typeof reproduceBuild>>["reproduction"] }
            | null = null;
        let compilerVersion: string | undefined;
        let sources: Record<string, { content: string }> | undefined;
        let target: string | undefined;
        let settings: Record<string, unknown> | undefined;
        let onchainRuntimeBytecode: string | undefined;

        if (typeof body.address === "string" && body.address.length > 0) {
            const chainId = typeof body.chainId === "number" ? body.chainId : 1;
            if (!/^0x[0-9a-fA-F]{40}$/.test(body.address)) {
                return NextResponse.json(
                    { success: false, error: "That is not a contract address." },
                    { status: 400 },
                );
            }

            const verified = await fetchVerified(chainId, body.address);
            const built = await reproduceBuild(verified);
            // Flattened text drives the source-reading analyses; the real file
            // map drives the compiler, which cannot resolve imports without it.
            code = verified.flattened;
            sources = verified.sources;
            target = verified.fullyQualifiedName;
            settings = verified.verifiedSettings ?? undefined;
            compilerVersion = verified.compilerVersion;
            onchainRuntimeBytecode = verified.onchainRuntimeBytecode;
            onchain = { address: body.address, chainId, reproduction: built.reproduction };
        }

        if (typeof code !== "string" || code.trim().length === 0) {
            return NextResponse.json(
                { success: false, error: "Contract source or a verified address is required" },
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
        const report = await buildChainFitReport({
            source: code,
            chains,
            compilerVersion,
            sources,
            target,
            settings,
            onchain,
            onchainRuntimeBytecode,
        });

        return NextResponse.json({
            success: true,
            report,
            metadata: {
                analysisTimeMs: Date.now() - startedAt,
                timestamp: new Date().toISOString(),
            },
        });
    } catch (error) {
        if (error instanceof NotVerifiedError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 404 });
        }

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
            code: "string - Solidity source. The compiler is chosen from its pragma.",
            address: "string - a verified contract address, used instead of code",
            chainId: "number - which chain that address is on, default 1",
            chains: "string[] (optional) - chain ids to compare, defaults to the full set",
        },
        method_notes: [
            "Ethereum gas is measured from a real EVM execution.",
            "Monad gas is that measurement adjusted by the MIP-8 schedule: cold state access, 128-slot storage pages, repriced precompiles and linear memory.",
            "Block time, block gas limit and gas price are probed live from each chain's public RPC.",
            "The compiler is resolved from the source's pragma, so contracts pinned to 0.4 through 0.8 all work.",
            "Given an address, the verified build is recompiled with its recorded settings and checked against the deployed code.",
        ],
    });
}
