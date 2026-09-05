/**
 * Builds a Chain Fit report: one contract, priced and characterised on every
 * chain in the comparison.
 *
 * The order of work matters. The contract is compiled once, deployed once into
 * a local EVM, and every function is then traced against that same deployed
 * state. Only after the measurements exist are chains brought in, because the
 * chain-specific numbers are all derived from the same traces rather than from
 * separate estimates that could disagree with each other.
 *
 * Everything returned here is JSON-safe. Gas prices are decimal strings rather
 * than bigints, and nothing is a Map, so the whole report survives the trip to
 * the browser without a custom serialiser.
 */

import type { Abi } from "viem";
import { encodeDeployData } from "viem";

import { analyzeParallelPotential } from "../parallelAnalyzer";
import { buildGasProfile } from "../gasProfiler";
import { compileContract, type CompileOutput } from "../solc";

import {
    callableFunctions,
    canonicalSignature,
    synthesiseCalls,
    synthesiseConstructorArgs,
    type ArgScale,
} from "./args";
import {
    CHAINS,
    DEFAULT_COMPARISON,
    getChain,
    type ChainId,
    type ChainProfile,
} from "./chains";
import {
    deriveFindings,
    sortFindings,
    type ChainFinding,
    type FindingEvidence,
} from "./findings";
import {
    effectiveGasPriceWei,
    fetchNativePrices,
    gasCostNative,
    probeAll,
    type ChainProbe,
} from "./probe";
import { explainDelta, monadDelta, repriceTrace, type ChainGas, type GasDelta } from "./reprice";
import { intrinsicGas, pageIndex } from "./schedules";
import {
    createTracingEvm,
    toBytes,
    traceCall,
    traceDeployment,
    type ExecutionTrace,
    type TraceStatus,
} from "./trace";

/**
 * How much a wallet typically pads an estimated gas limit by. Used to show what
 * Monad's charge-the-limit model costs when nobody sets the limit explicitly.
 */
export const WALLET_PADDING_FACTOR = 1.5;

export interface ChainCost {
    chain: ChainId;
    /** Wei per gas at the time of the probe, as a decimal string. */
    gasPriceWei: string | null;
    /** Native token spent on this call. */
    native: number | null;
    usd: number | null;
    /**
     * What the same call costs when the gas limit is padded by the usual wallet
     * factor. Identical to `usd` on chains that charge for gas used.
     */
    usdPadded: number | null;
}

export interface CallSample {
    scale: ArgScale;
    status: TraceStatus;
    revertReason: string | null;
    /** Total gas, execution plus intrinsic, on the Ethereum schedule. */
    ethereumGas: number;
    monadGas: number;
    calldataBytes: number;
}

export interface FunctionReport {
    signature: string;
    name: string;
    stateMutability: string;
    status: TraceStatus;
    revertReason: string | null;
    /** One entry per input scale tried. */
    samples: CallSample[];
    /** Gas on each chain, for the representative sample. */
    gas: Record<string, ChainGas>;
    cost: Record<string, ChainCost>;
    delta: GasDelta;
    explanations: ReturnType<typeof explainDelta>;
    /** Present when the function's cost moves with its input size. */
    gasSpread: { minGas: number; maxGas: number; spreadPct: number } | null;
}

export interface DeploymentReport {
    status: TraceStatus;
    revertReason: string | null;
    runtimeCodeSize: number;
    initCodeSize: number;
    gas: Record<string, ChainGas>;
    cost: Record<string, ChainCost>;
    delta: GasDelta;
    explanations: ReturnType<typeof explainDelta>;
    /** Chains where this contract is too large to deploy at all. */
    blockedOn: ChainId[];
}

/** The serialisable slice of a chain profile the UI needs. */
export interface ChainCard {
    id: ChainId;
    name: string;
    shortName: string;
    chainId: number;
    explorer: string;
    currencySymbol: string;
    accent: string;
    executionModel: ChainProfile["executionModel"];
    gasCharging: ChainProfile["gasCharging"];
    settlement: ChainProfile["settlement"];
    dataFee: ChainProfile["dataFee"];
    maxCodeSize: ChainProfile["maxCodeSize"];
    maxInitCodeSize: ChainProfile["maxInitCodeSize"];
    softFinalityMs: ChainProfile["softFinalityMs"];
    hardFinalityMs: ChainProfile["hardFinalityMs"];
    withdrawalWindowMs: ChainProfile["withdrawalWindowMs"];
    globalMempool: boolean;
    blobs: boolean;
    caveats: string[];
    probe: ChainProbe;
    nativeUsd: number | null;
}

export interface ChainFitReport {
    contractName: string;
    generatedAt: string;
    compiledWith: string;
    chains: ChainCard[];
    deployment: DeploymentReport;
    functions: FunctionReport[];
    findings: ChainFinding[];
    parallel: {
        score: number;
        grade: string;
        headline: string;
        summary: string;
        totalFunctions: number;
        parallelizableFunctions: number;
        pairsTotal: number;
        pairsBlocked: number;
        pairsConditional: number;
        hotspots: { variable: string; severity: string; impact: string }[];
    };
    /** Things the reader should know about how much to trust the numbers. */
    caveats: string[];
    warnings: string[];
}

export interface ChainFitOptions {
    source: string;
    chains?: readonly ChainId[];
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
        : sorted[middle];
}

function emptyDelta(): GasDelta {
    return { storage: 0, accountAccess: 0, memory: 0, precompiles: 0, total: 0 };
}

function addDelta(into: GasDelta, from: GasDelta): void {
    into.storage += from.storage;
    into.accountAccess += from.accountAccess;
    into.memory += from.memory;
    into.precompiles += from.precompiles;
    into.total += from.total;
}

/** Cost of `gas` units on one chain, including the padded-limit case. */
function costFor(
    chain: ChainProfile,
    probe: ChainProbe,
    nativeUsd: number | null,
    gas: number,
): ChainCost {
    const priceWei = effectiveGasPriceWei(probe);
    if (priceWei === null) {
        return { chain: chain.id, gasPriceWei: null, native: null, usd: null, usdPadded: null };
    }

    const native = gasCostNative(gas, priceWei);
    // Padding only costs money where the limit itself is what gets charged.
    const paddedGas = chain.gasCharging === "gas_limit" ? gas * WALLET_PADDING_FACTOR : gas;
    const nativePadded = gasCostNative(paddedGas, priceWei);

    return {
        chain: chain.id,
        gasPriceWei: priceWei.toString(),
        native,
        usd: nativeUsd === null ? null : native * nativeUsd,
        usdPadded: nativeUsd === null ? null : nativePadded * nativeUsd,
    };
}

function priceAcrossChains(
    profiles: readonly ChainProfile[],
    probes: Map<ChainId, ChainProbe>,
    prices: Record<string, number>,
    trace: ExecutionTrace,
): { gas: Record<string, ChainGas>; cost: Record<string, ChainCost> } {
    const gas: Record<string, ChainGas> = {};
    const cost: Record<string, ChainCost> = {};

    for (const profile of profiles) {
        const probe = probes.get(profile.id);
        if (probe === undefined) continue;
        const priced = repriceTrace(trace, profile);
        gas[profile.id] = priced;
        const nativeUsd =
            profile.coingeckoId === null ? null : (prices[profile.coingeckoId] ?? null);
        cost[profile.id] = costFor(profile, probe, nativeUsd, priced.totalGas);
    }

    return { gas, cost };
}

export async function buildChainFitReport(options: ChainFitOptions): Promise<ChainFitReport> {
    const warnings: string[] = [];
    const selected = options.chains ?? DEFAULT_COMPARISON;
    const profiles = CHAINS.filter((chain) => selected.includes(chain.id));
    if (profiles.length === 0) throw new Error("No chains selected for comparison");

    const compiled: CompileOutput = compileContract(options.source, [
        "abi",
        "evm.bytecode",
        "evm.deployedBytecode",
        "evm.gasEstimates",
    ]);
    warnings.push(...compiled.warnings.slice(0, 5));

    const abi = compiled.contract.abi as Abi;
    const bytecode = compiled.contract.evm?.bytecode?.object;
    if (bytecode === undefined || bytecode.length === 0) {
        throw new Error(
            "This source produced no bytecode. Interfaces and abstract contracts cannot be measured.",
        );
    }
    const deployedBytecode = compiled.contract.evm?.deployedBytecode?.object ?? "";

    // Network state and prices are independent of the trace, so start them now
    // and collect them once the local measurements are done.
    const networkPromise = Promise.all([probeAll(), fetchNativePrices()]);

    // ---- Deploy into a local EVM ----
    let initCodeHex = `0x${bytecode.replace(/^0x/, "")}`;
    try {
        const constructorArgs = synthesiseConstructorArgs(abi);
        initCodeHex = encodeDeployData({
            abi,
            bytecode: initCodeHex as `0x${string}`,
            args: constructorArgs,
        } as Parameters<typeof encodeDeployData>[0]);
    } catch {
        warnings.push(
            "Constructor arguments could not be synthesised, so the contract was deployed without them.",
        );
    }

    const initCode = toBytes(initCodeHex);
    const evm = await createTracingEvm();
    const deploymentTrace = await traceDeployment(evm, initCode, intrinsicGas(initCode, true));

    if (deploymentTrace.status !== "ok") {
        warnings.push(
            `The constructor did not complete with synthesised arguments (${deploymentTrace.revertReason ?? deploymentTrace.status}). ` +
                "Function-level numbers are unavailable; size and source findings still apply.",
        );
    }

    // ---- Trace every state-changing function ----
    const functionReports: FunctionReport[] = [];
    const traces: ExecutionTrace[] = [];
    const calldataSizes: number[] = [];

    const [probeList, prices] = await networkPromise;
    const probes = new Map(probeList.map((probe) => [probe.chain, probe] as const));

    if (deploymentTrace.status === "ok" && deploymentTrace.address !== null) {
        for (const fn of callableFunctions(abi)) {
            const calls = synthesiseCalls(abi, fn);
            if (calls.length === 0) continue;

            const samples: CallSample[] = [];
            const perScale: { scale: ArgScale; trace: ExecutionTrace }[] = [];

            for (const call of calls) {
                const calldata = toBytes(call.calldata);
                const trace = await traceCall(
                    evm,
                    deploymentTrace.address,
                    calldata,
                    intrinsicGas(calldata, false),
                );
                perScale.push({ scale: call.scale, trace });
                const delta = monadDelta(trace);
                samples.push({
                    scale: call.scale,
                    status: trace.status,
                    revertReason: trace.revertReason,
                    ethereumGas: trace.ethereumExecutionGas + trace.intrinsicGas,
                    monadGas: trace.ethereumExecutionGas + delta.total + trace.intrinsicGas,
                    calldataBytes: calldata.length,
                });
            }

            // The representative sample is the largest one that actually ran, so a
            // function whose smallest input short-circuits is not reported as free.
            const successful = perScale.filter((entry) => entry.trace.status === "ok");
            const representative =
                successful.length > 0 ? successful[successful.length - 1] : perScale[0];

            const trace = representative.trace;
            if (trace.status === "ok") {
                traces.push(trace);
                calldataSizes.push(
                    samples.find((sample) => sample.scale === representative.scale)
                        ?.calldataBytes ?? 0,
                );
            }

            const okSamples = samples.filter((sample) => sample.status === "ok");
            const gasValues = okSamples.map((sample) => sample.ethereumGas);
            const gasSpread =
                gasValues.length > 1
                    ? {
                          minGas: Math.min(...gasValues),
                          maxGas: Math.max(...gasValues),
                          spreadPct:
                              Math.min(...gasValues) === 0
                                  ? 0
                                  : Math.round(
                                        ((Math.max(...gasValues) - Math.min(...gasValues)) /
                                            Math.min(...gasValues)) *
                                            100,
                                    ),
                      }
                    : null;

            const { gas, cost } = priceAcrossChains(profiles, probes, prices.usd, trace);
            const delta = monadDelta(trace);

            functionReports.push({
                signature: canonicalSignature(fn),
                name: fn.name,
                stateMutability: fn.stateMutability ?? "nonpayable",
                status: trace.status,
                revertReason: trace.revertReason,
                samples,
                gas,
                cost,
                delta,
                explanations: explainDelta(trace, delta),
                gasSpread,
            });
        }
    }

    // ---- Deployment pricing ----
    const deploymentPriced = priceAcrossChains(profiles, probes, prices.usd, deploymentTrace);
    const deploymentDelta = monadDelta(deploymentTrace);
    const runtimeCodeSize =
        deploymentTrace.runtimeCodeSize > 0
            ? deploymentTrace.runtimeCodeSize
            : Math.floor(deployedBytecode.replace(/^0x/, "").length / 2);

    const deployment: DeploymentReport = {
        status: deploymentTrace.status,
        revertReason: deploymentTrace.revertReason,
        runtimeCodeSize,
        initCodeSize: deploymentTrace.initCodeSize,
        gas: deploymentPriced.gas,
        cost: deploymentPriced.cost,
        delta: deploymentDelta,
        explanations: explainDelta(deploymentTrace, deploymentDelta),
        blockedOn: profiles
            .filter((chain) => runtimeCodeSize > chain.maxCodeSize.value)
            .map((chain) => chain.id),
    };

    // ---- Existing analysers ----
    // Analysed against the same contract that was compiled, so the two agree on
    // which contract in a multi-contract file is the subject.
    const parallelResult = analyzeParallelPotential(options.source, compiled.contractName);
    let unboundedFunctions: string[] = [];
    try {
        const gasProfile = buildGasProfile(options.source, compiled);
        unboundedFunctions = gasProfile.functions
            .filter((entry) => entry.classification === "unbounded")
            .map((entry) => entry.signature);
    } catch {
        warnings.push("solc gas estimates were unavailable, so unbounded functions were not flagged.");
    }

    // ---- Aggregate evidence for the rules ----
    const totalDelta = emptyDelta();
    const accounts = new Set<string>();
    const pages = new Set<string>();
    const slots = new Set<string>();
    const opcodes = new Set<string>();
    const precompiles = new Set<string>();
    let peakMemoryWords = 0;
    let maxFunctionGas = 0;

    const allTraces = deploymentTrace.status === "ok" ? [deploymentTrace, ...traces] : traces;
    for (const trace of allTraces) {
        addDelta(totalDelta, monadDelta(trace));
        for (const access of trace.accountAccesses) accounts.add(access.address);
        for (const access of trace.storageAccesses) {
            slots.add(`${access.account}:${access.slot}`);
            pages.add(`${access.account}:${pageIndex(access.slot)}`);
        }
        for (const name of Object.keys(trace.opcodeCounts)) opcodes.add(name);
        for (const call of trace.precompileCalls) precompiles.add(call.name);
        for (const words of trace.frameMemoryWords) {
            if (words > peakMemoryWords) peakMemoryWords = words;
        }
        const total = trace.ethereumExecutionGas + trace.intrinsicGas;
        if (total > maxFunctionGas) maxFunctionGas = total;
    }

    const evidence: FindingEvidence = {
        chains: profiles,
        runtimeCodeSize,
        initCodeSize: deploymentTrace.initCodeSize,
        totalDelta,
        distinctAccountsTouched: accounts.size,
        distinctPages: pages.size,
        distinctSlots: slots.size,
        peakMemoryWords,
        precompilesUsed: Array.from(precompiles),
        maxFunctionGas,
        gasSpread: functionReports
            .filter((report) => report.gasSpread !== null)
            .map((report) => ({
                signature: report.signature,
                minGas: report.gasSpread!.minGas,
                maxGas: report.gasSpread!.maxGas,
            })),
        unboundedFunctions,
        parallel: {
            score: parallelResult.score,
            grade: parallelResult.grade,
            parallelizableFunctions: parallelResult.parallelizableFunctions,
            totalFunctions: parallelResult.totalFunctions,
            pairsTotal: parallelResult.metrics.pairsTotal,
            pairsBlocked: parallelResult.metrics.pairsBlocked,
            pairsConditional: parallelResult.metrics.pairsConditional,
            hotspots: parallelResult.hotspots.map((hotspot) => hotspot.variable),
        },
        tracedCallCount: allTraces.length,
        opcodes,
        source: options.source,
        medianCalldataBytes: median(calldataSizes),
    };

    const chainCards: ChainCard[] = profiles.map((chain) => {
        const probe = probes.get(chain.id);
        return {
            id: chain.id,
            name: chain.name,
            shortName: chain.shortName,
            chainId: chain.chainId,
            explorer: chain.explorer,
            currencySymbol: chain.currencySymbol,
            accent: chain.accent,
            executionModel: chain.executionModel,
            gasCharging: chain.gasCharging,
            settlement: chain.settlement,
            dataFee: chain.dataFee,
            maxCodeSize: chain.maxCodeSize,
            maxInitCodeSize: chain.maxInitCodeSize,
            softFinalityMs: chain.softFinalityMs,
            hardFinalityMs: chain.hardFinalityMs,
            withdrawalWindowMs: chain.withdrawalWindowMs,
            globalMempool: chain.globalMempool,
            blobs: chain.blobs,
            caveats: chain.caveats,
            probe:
                probe ?? {
                    chain: chain.id,
                    reachable: false,
                    error: "not probed",
                    reportedChainId: null,
                    blockNumber: null,
                    blockTimeMs: null,
                    blockGasLimit: null,
                    gasPriceWei: null,
                    baseFeeWei: null,
                    measuredAt: new Date().toISOString(),
                },
            nativeUsd:
                chain.coingeckoId === null ? null : (prices.usd[chain.coingeckoId] ?? null),
        };
    });

    // The parallel analyser reads the source file, so inherited entrypoints from
    // an imported base contract are outside its view. The ABI knows about them,
    // and a coverage gap has to be stated rather than left for the reader to
    // discover: a grade A over two of eight functions is not a grade A.
    const abiCallableCount = callableFunctions(abi).length;
    const parallelCoverageGap = abiCallableCount - parallelResult.totalFunctions;

    const caveats = [
        "Gas figures come from executing the contract in a local EVM with synthesised arguments. A function guarded by a balance or permission check will revert, and reverted calls are marked rather than counted.",
        "Only state-changing functions are traced. View and pure functions cost nothing to call from outside a transaction.",
        "Only execution and intrinsic gas is modelled. Rollups additionally charge for publishing calldata to Ethereum, which is not included.",
        "Ethereum storage cost is measured from the EVM. The Monad figure is that measurement adjusted by the published MIP-8 schedule.",
    ];
    if (!prices.available) {
        caveats.push("Token prices were unavailable, so only gas units and native amounts are shown.");
    }
    if (parallelCoverageGap > 0) {
        caveats.push(
            `The parallel analysis covers the ${parallelResult.totalFunctions} entrypoint` +
                `${parallelResult.totalFunctions === 1 ? "" : "s"} declared in this file. ` +
                `${parallelCoverageGap} more come from inherited contracts and are not included in the ` +
                `score, though they are included in the gas measurements.`,
        );
    }

    return {
        contractName: compiled.contractName,
        generatedAt: new Date().toISOString(),
        compiledWith: "solc 0.8 with the optimizer enabled at 200 runs",
        chains: chainCards,
        deployment,
        functions: functionReports,
        findings: sortFindings(deriveFindings(evidence)),
        parallel: {
            score: parallelResult.score,
            grade: parallelResult.grade,
            headline: parallelResult.headline,
            summary: parallelResult.summary,
            totalFunctions: parallelResult.totalFunctions,
            parallelizableFunctions: parallelResult.parallelizableFunctions,
            pairsTotal: parallelResult.metrics.pairsTotal,
            pairsBlocked: parallelResult.metrics.pairsBlocked,
            pairsConditional: parallelResult.metrics.pairsConditional,
            hotspots: parallelResult.hotspots.map((hotspot) => ({
                variable: hotspot.variable,
                severity: hotspot.severity,
                impact: hotspot.impact,
            })),
        },
        caveats,
        warnings,
    };
}

export { getChain };
