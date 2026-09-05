/**
 * Turns measurements into conclusions a developer can act on.
 *
 * Two rules govern what belongs here. A finding must be derived from something
 * observed about *this* contract, not from a general claim about a chain: "your
 * router touches 14 distinct addresses, which costs 105,000 more gas on Monad"
 * rather than "Monad reprices account access". And a finding must be allowed to
 * be bad news. A comparison that only ever finds advantages is an advertisement,
 * and the reader can tell.
 */

import type { ChainId, ChainProfile } from "./chains";
import type { GasDelta } from "./reprice";
import {
    ETHEREUM_MAX_CODE_SIZE,
    MONAD_MAX_CODE_SIZE,
    MONAD_MEMORY_LIMIT_BYTES,
} from "./schedules";

/** Where in the development journey the finding lands. */
export type JourneyStage =
    | "architect"
    | "write"
    | "test"
    | "deploy"
    | "run"
    | "scale"
    | "observe";

export const JOURNEY_STAGES: ReadonlyArray<{ id: JourneyStage; label: string; blurb: string }> = [
    { id: "architect", label: "Architect", blurb: "Limits your design has to fit inside" },
    { id: "write", label: "Write", blurb: "Language, libraries and tooling parity" },
    { id: "test", label: "Test", blurb: "Local runs, tracing and faucets" },
    { id: "deploy", label: "Deploy", blurb: "What it costs to get the contract on chain" },
    { id: "run", label: "Run", blurb: "What each call costs a user, and how fast it settles" },
    { id: "scale", label: "Scale", blurb: "Headroom, throughput and parallel execution" },
    { id: "observe", label: "Observe", blurb: "Indexing, history and mempool visibility" },
];

/**
 * `blocker` stops the contract working at all. `cost` changes what users pay.
 * `design` forces a code or architecture change. `advantage` is a measured win.
 * `info` is context with no action attached.
 */
export type FindingImpact = "blocker" | "cost" | "design" | "advantage" | "info";

export interface ChainFinding {
    id: string;
    stage: JourneyStage;
    impact: FindingImpact;
    title: string;
    detail: string;
    /** Chains where this finding bites. Empty means it is not chain-specific. */
    affects: ChainId[];
    /** Chains where the same contract does not have this problem. */
    clearedOn: ChainId[];
    /** The measurement behind the finding, when there is one. */
    metric: { label: string; value: string } | null;
    /** What to do about it. Null when there is nothing to do. */
    action: string | null;
    source: string | null;
}

/** Everything the rules are allowed to look at. */
export interface FindingEvidence {
    chains: readonly ChainProfile[];
    runtimeCodeSize: number;
    initCodeSize: number;
    /** Aggregate deltas over every successfully traced state-changing function. */
    totalDelta: GasDelta;
    /** Distinct addresses touched across all traced calls. */
    distinctAccountsTouched: number;
    /** Distinct storage pages and slots touched across all traced calls. */
    distinctPages: number;
    distinctSlots: number;
    /** Peak memory words in any traced frame. */
    peakMemoryWords: number;
    /** Precompiles used, by name. */
    precompilesUsed: string[];
    /** Functions whose traced gas exceeds a chain's per-transaction limit. */
    maxFunctionGas: number;
    /** Functions whose gas moves with input size, and by how much. */
    gasSpread: { signature: string; minGas: number; maxGas: number }[];
    /** Functions solc could not bound, from the existing gas profiler. */
    unboundedFunctions: string[];
    /** Parallel analysis of the same source. */
    parallel: {
        score: number;
        grade: string;
        parallelizableFunctions: number;
        totalFunctions: number;
        /** Entrypoint pairs whose storage footprints overlap on a written slot. */
        pairsTotal: number;
        pairsBlocked: number;
        pairsConditional: number;
        /** The contended state variables, worst first. */
        hotspots: string[];
    };
    /** Number of traced calls the aggregate deltas are summed over. */
    tracedCallCount: number;
    /** Opcodes seen anywhere in the traces. */
    opcodes: ReadonlySet<string>;
    /** Raw source, for pattern rules that bytecode cannot answer. */
    source: string;
    /** Median calldata size across traced calls, which drives L2 data fees. */
    medianCalldataBytes: number;
}

const MONAD_TX_GAS_LIMIT = 30_000_000;

function bytes(value: number): string {
    if (value < 1024) return `${value} B`;
    return `${(value / 1024).toFixed(1)} KB`;
}

function gas(value: number): string {
    const sign = value > 0 ? "+" : "";
    return `${sign}${Math.round(value).toLocaleString("en-US")} gas`;
}

/** Chain ids in the comparison, other than Monad. */
function others(evidence: FindingEvidence): ChainId[] {
    return evidence.chains.map((chain) => chain.id).filter((id) => id !== "monad");
}

export function deriveFindings(evidence: FindingEvidence): ChainFinding[] {
    const findings: ChainFinding[] = [];
    const rest = others(evidence);
    const has = (id: ChainId) => evidence.chains.some((chain) => chain.id === id);

    // ---- Architect: contract size ----
    if (evidence.runtimeCodeSize > ETHEREUM_MAX_CODE_SIZE) {
        const blocked = evidence.chains
            .filter((chain) => evidence.runtimeCodeSize > chain.maxCodeSize.value)
            .map((chain) => chain.id);
        const fits = evidence.chains
            .filter((chain) => evidence.runtimeCodeSize <= chain.maxCodeSize.value)
            .map((chain) => chain.id);

        findings.push({
            id: "code-size",
            stage: "architect",
            impact: blocked.length > 0 ? "blocker" : "advantage",
            title:
                fits.includes("monad") && blocked.length > 0
                    ? "This contract does not fit on the chains it is being compared against"
                    : "Contract exceeds the 24 KB limit",
            detail:
                `The runtime bytecode is ${bytes(evidence.runtimeCodeSize)}. EIP-170 caps it at ` +
                `${bytes(ETHEREUM_MAX_CODE_SIZE)} on Ethereum and every L2 here, so deploying there ` +
                `means splitting the contract behind a proxy or a diamond. Monad's limit is ` +
                `${bytes(MONAD_MAX_CODE_SIZE)}, so it deploys as a single contract.`,
            affects: blocked,
            clearedOn: fits,
            metric: { label: "Runtime bytecode", value: bytes(evidence.runtimeCodeSize) },
            action:
                blocked.length > 0
                    ? "Either split the contract for the other chains, or deploy it whole on Monad."
                    : null,
            source: "https://eips.ethereum.org/EIPS/eip-170",
        });
    } else if (evidence.runtimeCodeSize > ETHEREUM_MAX_CODE_SIZE * 0.85) {
        findings.push({
            id: "code-size-near-limit",
            stage: "architect",
            impact: "design",
            title: "Contract is close to the 24 KB ceiling",
            detail:
                `At ${bytes(evidence.runtimeCodeSize)} the contract is within 15% of the EIP-170 limit ` +
                `that applies everywhere except Monad. Another feature or two and it stops deploying ` +
                `on Ethereum and the L2s.`,
            affects: rest,
            clearedOn: ["monad"],
            metric: {
                label: "Headroom before EIP-170",
                value: bytes(ETHEREUM_MAX_CODE_SIZE - evidence.runtimeCodeSize),
            },
            action: "Watch the size, or plan the proxy split now rather than under deadline.",
            source: "https://eips.ethereum.org/EIPS/eip-170",
        });
    }

    // ---- Run: cold account access ----
    if (evidence.totalDelta.accountAccess > 0) {
        findings.push({
            id: "cold-account-access",
            stage: "run",
            impact: "cost",
            title: "Cross-contract calls cost more gas units on Monad",
            detail:
                `The traced calls touch ${evidence.distinctAccountsTouched} distinct address` +
                `${evidence.distinctAccountsTouched === 1 ? "" : "es"}. Monad charges 10,100 gas for the ` +
                `first access to an account against 2,600 elsewhere, which adds ` +
                `${gas(evidence.totalDelta.accountAccess)} across the ${evidence.tracedCallCount} calls ` +
                `traced. Gas units are not the ` +
                `same as money: whether this matters depends on the gas price, which the cost table shows.`,
            affects: ["monad"],
            clearedOn: rest,
            metric: { label: "Account access delta", value: gas(evidence.totalDelta.accountAccess) },
            action:
                "Cache values fetched from other contracts inside a call rather than re-reading them, and prefer one batched external call to several.",
            source: "https://docs.monad.xyz/developer-essentials/opcode-pricing",
        });
    }

    // ---- Run: storage pages ----
    if (evidence.totalDelta.storage < 0) {
        findings.push({
            id: "storage-pages-win",
            stage: "run",
            impact: "advantage",
            title: "Storage layout already suits Monad's page model",
            detail:
                `The traced calls touch ${evidence.distinctSlots} slot` +
                `${evidence.distinctSlots === 1 ? "" : "s"} spread over ${evidence.distinctPages} page` +
                `${evidence.distinctPages === 1 ? "" : "s"}. Monad warms 128 consecutive slots at once, so ` +
                `neighbouring variables cost 100 gas each after the first, saving ` +
                `${gas(evidence.totalDelta.storage)} across the ${evidence.tracedCallCount} calls traced.`,
            affects: [],
            clearedOn: ["monad"],
            metric: { label: "Storage delta", value: gas(evidence.totalDelta.storage) },
            action: null,
            source: "https://docs.monad.xyz/developer-essentials/opcode-pricing",
        });
    } else if (evidence.totalDelta.storage > 0) {
        findings.push({
            id: "storage-pages-loss",
            stage: "run",
            impact: "design",
            title: "Storage is spread too thinly to amortise Monad's page charge",
            detail:
                `${evidence.distinctSlots} slot${evidence.distinctSlots === 1 ? "" : "s"} across ` +
                `${evidence.distinctPages} page${evidence.distinctPages === 1 ? "" : "s"}. Monad pays 8,100 ` +
                `gas for the first touch of each 128-slot page, so slots that sit alone on a page cost ` +
                `more than they would on a per-slot schedule. Summed over the ${evidence.tracedCallCount} ` +
                `calls traced, that is ${gas(evidence.totalDelta.storage)}.`,
            affects: ["monad"],
            clearedOn: rest,
            metric: { label: "Storage delta", value: gas(evidence.totalDelta.storage) },
            action:
                "Group state that is read together into a struct so it lands on one page. Each mapping key gets its own page, but a struct stored under that key shares it.",
            source: "https://docs.monad.xyz/developer-essentials/opcode-pricing",
        });
    }

    // ---- Run: memory ----
    if (evidence.totalDelta.memory < -1_000) {
        findings.push({
            id: "memory-linear",
            stage: "run",
            impact: "advantage",
            title: "Memory-heavy code is much cheaper on Monad",
            detail:
                `Peak memory use is ${evidence.peakMemoryWords.toLocaleString("en-US")} words. Ethereum ` +
                `charges 3w + w²/512 for expansion, so the cost grows faster than the allocation; Monad ` +
                `charges w/2. Across the traced calls that is ${gas(evidence.totalDelta.memory)}.`,
            affects: [],
            clearedOn: ["monad"],
            metric: { label: "Memory delta", value: gas(evidence.totalDelta.memory) },
            action: null,
            source: "https://docs.monad.xyz/developer-essentials/opcode-pricing",
        });
    }
    if (evidence.peakMemoryWords * 32 > MONAD_MEMORY_LIMIT_BYTES * 0.5) {
        findings.push({
            id: "memory-cap",
            stage: "architect",
            impact: "design",
            title: "Approaching Monad's 8 MB memory cap",
            detail:
                `A traced frame reached ${bytes(evidence.peakMemoryWords * 32)} of memory. Monad caps a ` +
                `transaction at 8 MB across all frames; exceeding it halts the frame as an out-of-gas.`,
            affects: ["monad"],
            clearedOn: rest,
            metric: { label: "Peak memory", value: bytes(evidence.peakMemoryWords * 32) },
            action: "Process large inputs in batches rather than loading them into memory at once.",
            source: "https://docs.monad.xyz/developer-essentials/opcode-pricing",
        });
    }

    // ---- Run: precompiles ----
    if (evidence.precompilesUsed.length > 0 && evidence.totalDelta.precompiles > 0) {
        findings.push({
            id: "precompiles-repriced",
            stage: "run",
            impact: "cost",
            title: "This contract uses precompiles Monad charges more for",
            detail:
                `${evidence.precompilesUsed.join(", ")} in use. Monad charges 2x to 5x the Ethereum price ` +
                `for these, adding ${gas(evidence.totalDelta.precompiles)}. Signature-verifying contracts ` +
                `such as permit flows and meta-transaction relays feel this most.`,
            affects: ["monad"],
            clearedOn: rest,
            metric: { label: "Precompile delta", value: gas(evidence.totalDelta.precompiles) },
            action:
                "Where the signatures are passkeys rather than secp256k1, Monad's P256 precompile at 0x0100 is a cheaper path than verifying in Solidity.",
            source: "https://docs.monad.xyz/developer-essentials/opcode-pricing",
        });
    }

    // ---- Run: the gas limit charging model ----
    const wideSpreads = evidence.gasSpread.filter(
        (entry) => entry.maxGas > 0 && entry.maxGas - entry.minGas > entry.minGas * 0.25,
    );
    if (wideSpreads.length > 0 || evidence.unboundedFunctions.length > 0) {
        const worst = wideSpreads
            .slice()
            .sort((a, b) => b.maxGas - b.minGas - (a.maxGas - a.minGas))[0];
        const detailParts: string[] = [
            "Monad debits the sender for the transaction's gas limit, not the gas it uses, so anything a wallet pads onto the estimate is spent.",
        ];
        if (worst !== undefined) {
            const spread = worst.maxGas - worst.minGas;
            detailParts.push(
                `${worst.signature} ranges from ${worst.minGas.toLocaleString("en-US")} to ` +
                    `${worst.maxGas.toLocaleString("en-US")} gas depending on input size, a spread of ` +
                    `${spread.toLocaleString("en-US")} gas. A limit set for the worst case overpays by that ` +
                    `much on the common case.`,
            );
        }
        if (evidence.unboundedFunctions.length > 0) {
            detailParts.push(
                `solc cannot bound ${evidence.unboundedFunctions.slice(0, 3).join(", ")}` +
                    `${evidence.unboundedFunctions.length > 3 ? ` and ${evidence.unboundedFunctions.length - 3} more` : ""}, ` +
                    `which is where wallets fall back to a large default limit.`,
            );
        }

        findings.push({
            id: "gas-limit-charging",
            stage: "run",
            impact: "cost",
            title: "Gas variance costs real money on Monad",
            detail: detailParts.join(" "),
            affects: ["monad"],
            clearedOn: rest,
            metric:
                worst === undefined
                    ? { label: "Unbounded functions", value: String(evidence.unboundedFunctions.length) }
                    : {
                          label: "Widest gas spread",
                          value: `${(worst.maxGas - worst.minGas).toLocaleString("en-US")} gas`,
                      },
            action:
                "Bound the loops, and have your frontend set an explicit gas limit for operations whose cost is fixed rather than letting the wallet estimate and pad.",
            source: "https://docs.monad.xyz/developer-essentials/gas-pricing",
        });
    }

    // ---- Architect: per-transaction gas ceiling ----
    if (evidence.maxFunctionGas > MONAD_TX_GAS_LIMIT) {
        findings.push({
            id: "tx-gas-limit",
            stage: "architect",
            impact: "blocker",
            title: "A function exceeds Monad's per-transaction gas limit",
            detail:
                `The most expensive traced call uses ${evidence.maxFunctionGas.toLocaleString("en-US")} gas, ` +
                `above the 30,000,000 a single Monad transaction may consume.`,
            affects: ["monad"],
            clearedOn: [],
            metric: { label: "Peak call gas", value: `${evidence.maxFunctionGas.toLocaleString("en-US")} gas` },
            action: "Split the work across transactions, or make the batch size a parameter.",
            source: "https://docs.monad.xyz/developer-essentials/gas-pricing",
        });
    }

    // ---- Scale: parallel execution ----
    const { parallel } = evidence;
    if (parallel.totalFunctions > 0) {
        const isGood = parallel.score >= 70;
        const collisionDetail =
            parallel.pairsTotal === 0
                ? ""
                : ` ${parallel.pairsBlocked} of ${parallel.pairsTotal} entrypoint pairs always collide` +
                  (parallel.pairsConditional > 0
                      ? `, and ${parallel.pairsConditional} more collide when they touch the same key`
                      : "") +
                  (parallel.hotspots.length > 0
                      ? `, on ${parallel.hotspots.slice(0, 3).join(", ")}`
                      : "") +
                  ".";

        findings.push({
            id: "parallel-execution",
            stage: "scale",
            impact: isGood ? "advantage" : "design",
            title: isGood
                ? "Contract is shaped for parallel execution"
                : "State contention will serialise this contract",
            detail:
                `${parallel.parallelizableFunctions} of ${parallel.totalFunctions} entrypoints can run ` +
                `concurrently, grade ${parallel.grade}.${collisionDetail} ` +
                `This only converts into throughput on a chain that executes transactions in parallel. ` +
                `Monad does; every other chain in this comparison executes sequentially, so the same ` +
                `layout buys nothing there and costs nothing either.`,
            affects: isGood ? [] : ["monad"],
            clearedOn: isGood ? ["monad"] : [],
            metric: {
                label: "Colliding entrypoint pairs",
                value:
                    parallel.pairsTotal === 0
                        ? `${parallel.score}/100 (${parallel.grade})`
                        : `${parallel.pairsBlocked} of ${parallel.pairsTotal}`,
            },
            action: isGood
                ? null
                : "Key hot state by sender or by id instead of writing to one shared slot. The Parallel Profiler lists the exact pairs and the variables behind them.",
            source: "https://docs.monad.xyz/developer-essentials/best-practices",
        });
    }

    // ---- Run: settlement latency ----
    const optimistic = evidence.chains.filter((chain) => chain.settlement === "optimistic-rollup");
    if (optimistic.length > 0 && has("monad")) {
        findings.push({
            id: "settlement-latency",
            stage: "run",
            impact: "info",
            title: "How long before your app can say the transaction is done",
            detail:
                `Monad reaches deterministic finality in 600 ms, two consensus slots. ` +
                `${optimistic.map((chain) => chain.name).join(" and ")} confirm through a single sequencer ` +
                `within a couple of seconds, but that confirmation is a promise from the operator; ` +
                `irreversible settlement waits on Ethereum, and a withdrawal waits seven days. Ethereum ` +
                `itself takes about 12.8 minutes. Which number matters depends on what the user is ` +
                `allowed to do next.`,
            affects: optimistic.map((chain) => chain.id),
            clearedOn: ["monad"],
            metric: { label: "Monad hard finality", value: "600 ms" },
            action: null,
            source: "https://docs.monad.xyz/ai/current-facts",
        });
    }

    // ---- Deploy and run: L2 data fees ----
    const dataFeeChains = evidence.chains.filter((chain) => chain.dataFee !== "none");
    if (dataFeeChains.length > 0) {
        findings.push({
            id: "l1-data-fee",
            stage: "deploy",
            impact: "cost",
            title: "Rollups charge for calldata on top of execution gas",
            detail:
                `${dataFeeChains.map((chain) => chain.name).join(", ")} publish every transaction's calldata ` +
                `to Ethereum and bill for it separately. The traced calls carry a median of ` +
                `${evidence.medianCalldataBytes} bytes of calldata each. The gas figures in this report are ` +
                `execution gas only, so the real cost on those chains is higher than shown, by an amount ` +
                `that moves with Ethereum's fee market rather than with anything in your contract.`,
            affects: dataFeeChains.map((chain) => chain.id),
            clearedOn: (["monad", "ethereum", "polygon", "bnb"] as ChainId[]).filter(has),
            metric: { label: "Median calldata", value: `${evidence.medianCalldataBytes} B` },
            action: null,
            source: "https://docs.optimism.io/stack/transactions/fees",
        });
    }

    // ---- Observe: mempool ----
    if (has("monad")) {
        const usesCoinbase =
            evidence.opcodes.has("COINBASE") || /block\.coinbase/.test(evidence.source);
        findings.push({
            id: "no-global-mempool",
            stage: "observe",
            impact: usesCoinbase ? "design" : "info",
            title: "Monad has no global mempool",
            detail:
                `Transactions are forwarded to the next few block leaders rather than gossiped network-wide, ` +
                `so anything that watches pending transactions works differently. ` +
                (usesCoinbase
                    ? "This contract reads block.coinbase, which suggests a builder or MEV-aware design worth re-checking against Monad's model."
                    : "This contract does not appear to depend on pending-transaction visibility, so it is context rather than a change."),
            affects: ["monad"],
            clearedOn: evidence.chains
                .filter((chain) => chain.globalMempool)
                .map((chain) => chain.id),
            metric: null,
            action: usesCoinbase
                ? "Re-check any assumption that a searcher can observe this transaction before inclusion."
                : null,
            source: "https://docs.monad.xyz/developer-essentials/differences",
        });
    }

    // ---- Architect: blobs ----
    if (evidence.opcodes.has("BLOBHASH") || /blobhash|blobBaseFee/i.test(evidence.source)) {
        findings.push({
            id: "blob-dependency",
            stage: "architect",
            impact: "blocker",
            title: "This contract depends on blob transactions",
            detail:
                "EIP-4844 blobs are not supported on Monad, so any design that reads blob hashes or prices blob data needs a different data availability path.",
            affects: ["monad"],
            clearedOn: evidence.chains.filter((chain) => chain.blobs).map((chain) => chain.id),
            metric: null,
            action: "Move the data on-chain as calldata, or keep that component on a chain with blobs.",
            source: "https://docs.monad.xyz/developer-essentials/differences",
        });
    }

    // ---- Write: selfdestruct ----
    if (evidence.opcodes.has("SELFDESTRUCT") || /selfdestruct\s*\(/.test(evidence.source)) {
        findings.push({
            id: "selfdestruct",
            stage: "write",
            impact: "design",
            title: "SELFDESTRUCT is deprecated everywhere",
            detail:
                "EIP-6780 reduced SELFDESTRUCT to a balance transfer unless it runs in the same transaction that created the contract. Any design that relies on the code being removed no longer works on any chain here.",
            affects: evidence.chains.map((chain) => chain.id),
            clearedOn: [],
            metric: null,
            action: "Replace it with a pausable contract and an explicit withdrawal function.",
            source: "https://eips.ethereum.org/EIPS/eip-6780",
        });
    }

    // ---- Architect: EIP-7702 delegate targets ----
    if (
        has("monad") &&
        (evidence.opcodes.has("CREATE") || evidence.opcodes.has("CREATE2")) &&
        /7702|delegate|smart\s*account/i.test(evidence.source)
    ) {
        findings.push({
            id: "eip-7702-create",
            stage: "architect",
            impact: "design",
            title: "A 7702 delegate cannot use CREATE on Monad",
            detail:
                "This contract uses CREATE or CREATE2 and reads like it is meant to be an EIP-7702 delegate. Monad bans both opcodes for delegated EOAs and will not let such an account's balance fall below 10 MON.",
            affects: ["monad"],
            clearedOn: rest,
            metric: null,
            action: "Deploy factories as ordinary contracts and have the delegate call into them.",
            source: "https://docs.monad.xyz/developer-essentials/differences",
        });
    }

    return findings;
}

const IMPACT_ORDER: Record<FindingImpact, number> = {
    blocker: 0,
    cost: 1,
    design: 2,
    advantage: 3,
    info: 4,
};

/** Blockers first, context last. */
export function sortFindings(findings: readonly ChainFinding[]): ChainFinding[] {
    return findings.slice().sort((a, b) => IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact]);
}
