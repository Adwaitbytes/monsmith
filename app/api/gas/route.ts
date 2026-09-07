import { NextResponse } from "next/server";
import { compileVersioned } from "@/lib/solc/compile";
import { buildGasProfile } from "@/lib/gasProfiler";

/**
 * Per-function gas profiler.
 *
 * solc already computes an upper bound for every function while it builds the
 * control flow graph, so the profile costs one compile and no chain access. The
 * numbers are static estimates, not measured execution, which is exactly what a
 * developer wants before deploying.
 */
export async function POST(req: Request) {
    let code: unknown;

    try {
        ({ code } = await req.json());
    } catch {
        return NextResponse.json({ success: false, error: "Request body must be JSON" }, { status: 400 });
    }

    if (typeof code !== "string" || code.trim().length === 0) {
        return NextResponse.json({ success: false, error: "Contract code is required" }, { status: 400 });
    }

    const startedAt = Date.now();

    try {
        // deployedBytecode is requested for the EIP-170 size figure; bytecode is
        // what makes solc emit creation estimates at all.
        const compiled = await compileVersioned(code, {
            outputs: ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'evm.gasEstimates'],
        });

        const profile = buildGasProfile(code, compiled);

        return NextResponse.json({
            success: true,
            profile,
            metadata: {
                analysisTimeMs: Date.now() - startedAt,
                timestamp: new Date().toISOString(),
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Gas profiling failed";
        // A contract that does not compile is a user error, not a server fault,
        // so the compiler's own message is returned verbatim as a 400.
        return NextResponse.json({ success: false, error: message }, { status: 400 });
    }
}
