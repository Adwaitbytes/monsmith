import "server-only";

import { createRequire } from "node:module";
import path from "node:path";

import type { Abi } from "viem";

import { repairConcatenated } from "../flatten";
import { OPENZEPPELIN_SOURCES } from "../openzeppelin-bundle";
import { fixAddressChecksums, VIRTUAL_SOURCE, type CompiledContract } from "../solc";
import { chooseVersion } from "./pragma";
import {
    bundledShortVersion,
    findBuild,
    loadSolc,
    releaseBuilds,
    BUNDLED_VERSION,
} from "./registry";

/**
 * Compiling with whichever version the source asks for.
 *
 * The bundled compiler stays the fast path: when the pragma allows it there is
 * no download, no network, and nothing to go wrong. Everything else resolves
 * the pragma against the published releases and fetches that compiler once.
 *
 * The reason this matters is narrower than "support more versions". Uniswap V3
 * is `=0.7.6`, Uniswap V2 is `0.5.16`, and a tool that only speaks 0.8 cannot
 * measure the contracts people most want measured. The gas model was never the
 * limitation; the front door was.
 */

export interface CompilerUsed {
    /** Long version with commit, e.g. `0.7.6+commit.7338295f`. */
    longVersion: string;
    /** Bare version, e.g. `0.7.6`. */
    version: string;
    /** True when this is the compiler shipped in the bundle. */
    bundled: boolean;
    /** The pragma that drove the choice, when there was one. */
    pragma: string | null;
    /** Why this compiler, in words. */
    reason: string;
    /** Milliseconds spent obtaining the compiler, zero when it was already loaded. */
    loadMs: number;
}

export interface VersionedCompileResult {
    contractName: string;
    contract: CompiledContract;
    warnings: string[];
    compiler: CompilerUsed;
}

interface SolcError {
    severity: "error" | "warning" | "info";
    formattedMessage: string;
}

/** Resolves OpenZeppelin from the bundle, falling back to node_modules locally. */
function findImports(importPath: string): { contents: string } | { error: string } {
    const bundled = OPENZEPPELIN_SOURCES[importPath];
    if (bundled !== undefined) return { contents: bundled };

    try {
        // Only reachable in a local checkout; the deployed bundle has no node_modules.
        const fs = projectRequire("node:fs") as typeof import("node:fs");
        const candidate = path.join(process.cwd(), "node_modules", importPath);
        if (fs.existsSync(candidate)) return { contents: fs.readFileSync(candidate, "utf8") };
    } catch {
        // Fall through to the error below.
    }

    return { error: `Source "${importPath}" not found` };
}

/** Bound to the project root, so the bundler leaves the resolution alone. */
const projectRequire = createRequire(path.join(process.cwd(), "package.json"));

const DEFAULT_OUTPUTS = ["abi", "evm.bytecode", "evm.deployedBytecode", "evm.gasEstimates"];

export interface CompileOptions {
    /** Which compiler to use. Omit to resolve from the source's pragma. */
    version?: string;
    outputs?: string[];
    optimizerRuns?: number;
    optimizerEnabled?: boolean;
    /** Passed straight through when reproducing a verified build. */
    evmVersion?: string;
    /** Name of the contract to measure, when the caller knows it. */
    preferContract?: string;
    /**
     * Complete compiler settings, used verbatim except for `outputSelection`.
     *
     * Reproducing a verified build means using the settings it was built with,
     * all of them. `metadata.bytecodeHash`, `libraries`, `remappings` and
     * `viaIR` all change the output, and reconstructing a subset of them from
     * metadata produces bytecode that looks right and is not.
     */
    settings?: Record<string, unknown>;
}

/** A project's sources, keyed by the path each file imports the others under. */
export type SourceMap = Record<string, { content: string }>;

/**
 * Compiles a single source unit, choosing the compiler from its pragma.
 *
 * Throws with solc's own diagnostics on a compile error, because the message
 * the compiler produced is more useful than anything this layer could say
 * about it.
 */
interface AcquiredCompiler {
    compile(input: string, opts?: unknown): string;
    used: CompilerUsed;
}

/** Resolves the pragma, then obtains that compiler. Shared by both entry points. */
async function acquire(
    pragmaSource: string,
    options: CompileOptions,
): Promise<AcquiredCompiler> {
    let choice = {
        version: options.version ?? null,
        reason: options.version === undefined ? "" : `Compiler ${options.version} was requested.`,
        pragma: null as string | null,
    };

    if (options.version === undefined) {
        const builds = await releaseBuilds().catch(() => []);
        choice = chooseVersion(
            pragmaSource,
            builds.map((build) => build.version),
            bundledShortVersion(),
        );
    }

    if (choice.version === null) {
        throw new Error(
            `${choice.reason} Check the pragma, or pin a version the compiler list publishes.`,
        );
    }

    const startedAt = Date.now();
    const short = choice.version.split("+")[0];
    const useBundled = short === bundledShortVersion() && options.version === undefined;

    let compiler: { compile(input: string, opts?: unknown): string };
    let longVersion: string;

    if (useBundled) {
        compiler = projectRequire("solc");
        longVersion = BUNDLED_VERSION;
    } else {
        const build = await findBuild(choice.version);
        if (build === null) throw new Error(`No released compiler ${choice.version} is published.`);
        compiler = await loadSolc(build);
        longVersion = build.longVersion;
    }

    return {
        compile: (input, opts) => compiler.compile(input, opts),
        used: {
            longVersion,
            version: short,
            bundled: useBundled,
            pragma: choice.pragma,
            reason: choice.reason,
            loadMs: Date.now() - startedAt,
        },
    };
}

function readOutput(
    raw: string,
): { errors: SolcError[]; contracts: Record<string, Record<string, CompiledContract>> } {
    const output = JSON.parse(raw) as {
        errors?: SolcError[];
        contracts?: Record<string, Record<string, CompiledContract>>;
    };
    const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");
    if (errors.length > 0) {
        throw new Error(errors.map((entry) => entry.formattedMessage).join("\n"));
    }
    return { errors: output.errors ?? [], contracts: output.contracts ?? {} };
}

/** Compiles a single source unit, choosing the compiler from its pragma. */
export async function compileVersioned(
    sourceCode: string,
    options: CompileOptions = {},
): Promise<VersionedCompileResult> {
    // A document the old importer concatenated rather than flattened still has
    // its relative imports and cannot compile. It is recognisable and
    // repairable, and repairing beats making someone import the contract again.
    const source = fixAddressChecksums(repairConcatenated(sourceCode));
    const compiler = await acquire(source, options);

    const input = {
        language: "Solidity",
        sources: { [VIRTUAL_SOURCE]: { content: source } },
        settings: buildSettings(options),
    };

    const { errors, contracts: all } = readOutput(
        compiler.compile(JSON.stringify(input), { import: findImports }),
    );
    const contracts = all[VIRTUAL_SOURCE];
    if (contracts === undefined || Object.keys(contracts).length === 0) {
        throw new Error("No contracts found in compilation output");
    }

    const contractName = chooseContract(source, contracts, options.preferContract);

    return {
        contractName,
        contract: contracts[contractName],
        warnings: warningsOf(errors),
        compiler: compiler.used,
    };
}

/**
 * Compiles a multi-file project with its real import paths.
 *
 * Concatenating a project into one blob is not flattening: the relative imports
 * survive and solc cannot resolve them. Passing the files under the paths they
 * import each other by is both simpler and exactly what the compiler expects,
 * and it is the only way to reproduce a verified build byte for byte.
 */
export async function compileProject(
    sources: SourceMap,
    options: CompileOptions & { target?: string } = {},
): Promise<VersionedCompileResult & { allContracts: Record<string, string[]> }> {
    const pragmaSource = Object.values(sources).map((file) => file.content).join("\n");
    const compiler = await acquire(pragmaSource, options);

    const input = {
        language: "Solidity",
        sources,
        settings: buildSettings(options),
    };

    const { errors, contracts } = readOutput(
        compiler.compile(JSON.stringify(input), { import: findImports }),
    );

    const index: Record<string, string[]> = {};
    for (const [file, defined] of Object.entries(contracts)) index[file] = Object.keys(defined);

    // `target` is a fully qualified name, `path:Name`, as metadata records it.
    let file: string | undefined;
    let name: string | undefined;
    if (options.target !== undefined && options.target.includes(":")) {
        const [targetFile, targetName] = options.target.split(":");
        if (contracts[targetFile]?.[targetName] !== undefined) {
            file = targetFile;
            name = targetName;
        }
    }

    if (file === undefined || name === undefined) {
        let bestSize = -1;
        for (const [candidateFile, defined] of Object.entries(contracts)) {
            for (const [candidateName, contract] of Object.entries(defined)) {
                const size = (contract.evm?.deployedBytecode?.object ?? "").length;
                if (size > bestSize) {
                    bestSize = size;
                    file = candidateFile;
                    name = candidateName;
                }
            }
        }
    }

    if (file === undefined || name === undefined) {
        throw new Error("No contracts found in compilation output");
    }

    return {
        contractName: name,
        contract: contracts[file][name],
        warnings: warningsOf(errors),
        compiler: compiler.used,
        allContracts: index,
    };
}

function buildSettings(options: CompileOptions) {
    const outputSelection = { "*": { "*": options.outputs ?? DEFAULT_OUTPUTS } };

    // Verbatim settings win outright. Merging our defaults into them would
    // reintroduce exactly the differences reproduction exists to rule out.
    if (options.settings !== undefined) {
        return { ...options.settings, outputSelection };
    }

    const settings: Record<string, unknown> = {
        outputSelection,
        optimizer: {
            enabled: options.optimizerEnabled ?? true,
            runs: options.optimizerRuns ?? 200,
        },
    };
    // Only set when asked: an evmVersion an older compiler does not know is an error.
    if (options.evmVersion !== undefined) settings.evmVersion = options.evmVersion;
    return settings;
}

function warningsOf(errors: SolcError[]): string[] {
    return errors
        .filter((entry) => entry.severity === "warning")
        .map((entry) => entry.formattedMessage)
        .slice(0, 10);
}

/**
 * Which of a file's contracts the report is about.
 *
 * The last declaration wins, not the first. A flattened document ends with the
 * contract it was flattened for, because its dependencies had to precede it,
 * and taking the first would report on some interface it imports. A file with
 * one contract gives the same answer either way, and a hand-written file that
 * ends with a helper is the case this gets wrong, which is why an explicit name
 * takes priority over the guess.
 */
function chooseContract(
    source: string,
    contracts: Record<string, CompiledContract>,
    preferred?: string,
): string {
    if (preferred !== undefined && contracts[preferred] !== undefined) return preferred;

    const declared = [...source.matchAll(/^\s*(?:abstract\s+)?contract\s+(\w+)/gm)]
        .map((match) => match[1])
        .filter((name) => contracts[name] !== undefined);

    const last = declared[declared.length - 1];
    return last ?? pickDeployable(contracts);
}

/**
 * Fallback when no declaration matched a compiled contract: the largest one
 * that actually produces bytecode, since interfaces and libraries produce
 * little or none.
 */
function pickDeployable(contracts: Record<string, CompiledContract>): string {
    let best = Object.keys(contracts)[0];
    let bestSize = -1;

    for (const [name, contract] of Object.entries(contracts)) {
        const size = (contract.evm?.deployedBytecode?.object ?? "").length;
        if (size > bestSize) {
            best = name;
            bestSize = size;
        }
    }

    return best;
}

/**
 * Compiles for deployment, choosing the compiler from the pragma.
 *
 * The shape `compileSolidity` returned, so the callers that only wanted an ABI
 * and bytecode can move across without caring how the version was resolved.
 */
export async function compileForDeploy(
    sourceCode: string,
): Promise<{ abi: Abi; bytecode: string; compiler: CompilerUsed }> {
    const result = await compileVersioned(sourceCode, {
        outputs: ["abi", "evm.bytecode", "evm.deployedBytecode"],
    });

    const bytecode = result.contract.evm?.bytecode?.object;
    if (bytecode === undefined || bytecode.length === 0) {
        throw new Error(
            "Contract compilation produced no bytecode. Abstract contracts and interfaces cannot be deployed.",
        );
    }

    return { abi: result.contract.abi, bytecode, compiler: result.compiler };
}

export type { Abi };
