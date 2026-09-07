import "server-only";

import type { Abi } from "viem";

import { compileProject, type SourceMap } from "../solc/compile";
import { compareRuntimeBytecode, type ImmutableReference, type Reproduction } from "./verify";

/**
 * Loads a verified contract from Sourcify and reproduces its build.
 *
 * This is the path that makes the compiler work worth doing. Sourcify stores
 * the exact standard JSON input a contract was verified with: every source
 * file, the compiler version down to the commit, the optimizer runs, the
 * evmVersion, the metadata settings. Given that, there is no guessing left.
 * Compile it and the output should be the code on chain, and if it is not, that
 * is worth knowing before quoting a single gas figure.
 *
 * It also means a developer never has to find, flatten or paste anything. An
 * address is enough, and for a contract like Uniswap V3 spread over 96 files
 * that is the difference between a two-minute chore and a click.
 */

const SOURCIFY = "https://sourcify.dev/server/v2";
const TIMEOUT_MS = 30_000;

export interface VerifiedContract {
    address: string;
    chainId: number;
    name: string;
    fullyQualifiedName: string;
    compilerVersion: string;
    /** Optimizer and evmVersion as recorded at verification. */
    settings: { optimizer?: { enabled?: boolean; runs?: number }; evmVersion?: string };
    sources: SourceMap;
    /** The compiler settings recorded at verification, used verbatim. */
    verifiedSettings: Record<string, unknown> | null;
    abi: Abi;
    onchainRuntimeBytecode: string;
    /** Every source concatenated, for the text-based analyses. */
    flattened: string;
}

interface SourcifyResponse {
    address: string;
    chainId: string;
    compilation?: {
        name?: string;
        fullyQualifiedName?: string;
        compilerVersion?: string;
        language?: string;
    };
    sources?: Record<string, { content?: string }>;
    stdJsonInput?: { sources?: Record<string, { content?: string }>; settings?: Record<string, unknown> };
    metadata?: { settings?: { optimizer?: { enabled?: boolean; runs?: number }; evmVersion?: string } };
    abi?: Abi;
    runtimeBytecode?: { onchainBytecode?: string };
}

export class NotVerifiedError extends Error {
    constructor(address: string, chainId: number) {
        super(
            `${address} is not verified on Sourcify for chain ${chainId}. ` +
                "Paste the source instead, or verify the contract first.",
        );
        this.name = "NotVerifiedError";
    }
}

export async function fetchVerified(
    chainId: number,
    address: string,
): Promise<VerifiedContract> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const url = `${SOURCIFY}/contract/${chainId}/${address}?fields=sources,compilation,metadata,abi,runtimeBytecode,stdJsonInput`;
        const response = await fetch(url, { signal: controller.signal });
        if (response.status === 404) throw new NotVerifiedError(address, chainId);
        if (!response.ok) throw new Error(`Sourcify returned HTTP ${response.status}`);

        const data = (await response.json()) as SourcifyResponse;
        if (data.compilation?.language !== "Solidity") {
            throw new Error(
                `${address} is verified as ${data.compilation?.language ?? "an unknown language"}, and only Solidity can be measured.`,
            );
        }

        // Prefer the standard JSON input's sources: those are the exact paths the
        // contract was compiled under, and the imports resolve against them.
        const raw = data.stdJsonInput?.sources ?? data.sources ?? {};
        const sources: SourceMap = {};
        for (const [file, entry] of Object.entries(raw)) {
            sources[file] = { content: entry?.content ?? "" };
        }
        if (Object.keys(sources).length === 0) throw new Error("Sourcify returned no sources.");

        return {
            address,
            chainId,
            name: data.compilation?.name ?? address.slice(0, 10),
            fullyQualifiedName: data.compilation?.fullyQualifiedName ?? "",
            compilerVersion: data.compilation?.compilerVersion ?? "",
            settings: data.metadata?.settings ?? {},
            verifiedSettings: data.stdJsonInput?.settings ?? null,
            sources,
            abi: data.abi ?? [],
            onchainRuntimeBytecode: data.runtimeBytecode?.onchainBytecode ?? "",
            flattened: Object.values(sources).map((file) => file.content).join("\n"),
        };
    } finally {
        clearTimeout(timer);
    }
}

export interface ReproducedBuild {
    contract: VerifiedContract;
    contractName: string;
    abi: Abi;
    /** Compiler-produced creation bytecode, for tracing a deployment. */
    initCode: string;
    /** Compiler-produced runtime bytecode. */
    runtimeCode: string;
    compiler: { longVersion: string; version: string; loadMs: number };
    reproduction: Reproduction;
}

/**
 * Recompiles a verified contract with the settings it was verified under, and
 * checks the result against the deployed code.
 */
export async function reproduceBuild(contract: VerifiedContract): Promise<ReproducedBuild> {
    const optimizer = contract.settings.optimizer ?? {};
    const outputs = ["abi", "evm.bytecode", "evm.deployedBytecode", "evm.gasEstimates"];

    const compiled = await compileProject(contract.sources, {
        version: contract.compilerVersion,
        target: contract.fullyQualifiedName,
        outputs,
        // The recorded settings reproduce the build exactly; the metadata
        // fallback is an approximation and is only used when they are absent.
        ...(contract.verifiedSettings !== null
            ? { settings: contract.verifiedSettings }
            : {
                  optimizerEnabled: optimizer.enabled ?? false,
                  optimizerRuns: optimizer.runs ?? 200,
                  evmVersion: contract.settings.evmVersion,
              }),
    });

    const deployed = compiled.contract.evm?.deployedBytecode as
        | { object?: string; immutableReferences?: Record<string, ImmutableReference[]> }
        | undefined;

    const reproduction = compareRuntimeBytecode(
        deployed?.object ?? "",
        contract.onchainRuntimeBytecode,
        deployed?.immutableReferences ?? {},
    );

    return {
        contract,
        contractName: compiled.contractName,
        abi: (compiled.contract.abi ?? contract.abi) as Abi,
        initCode: compiled.contract.evm?.bytecode?.object ?? "",
        runtimeCode: deployed?.object ?? "",
        compiler: {
            longVersion: compiled.compiler.longVersion,
            version: compiled.compiler.version,
            loadMs: compiled.compiler.loadMs,
        },
        reproduction,
    };
}
