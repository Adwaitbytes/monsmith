/**
 * The development journey, stage by stage.
 *
 * The devrel question this answers is not "which chain is best" but "what
 * actually changes for me, at each point where I would notice". So the spine is
 * the sequence a developer moves through, and at every stage there is one
 * parameter that decides something, measured where it can be measured and cited
 * where it cannot.
 *
 * Two rules hold throughout. Values are computed from the registry and the live
 * probe rather than written by hand, so a stage cannot quietly disagree with the
 * matrix on the same page. And `tone` is derived by comparing the field, never
 * assigned: when Monad is the worst value in a row it is marked as the worst
 * value in that row. A page that renders the answer before the data has stopped
 * being a measurement.
 */

import type { ChainId, ChainProfile } from "./chains";
import type { JourneyStage } from "./findings";
import type { ChainProbe } from "./probe";
import { effectiveGasPriceWei } from "./probe";
import { ETHEREUM_MAX_CODE_SIZE } from "./schedules";

/** Roughly an ERC20 deployment. Used so the deploy stage has a concrete price. */
export const REFERENCE_DEPLOY_GAS = 700_000;
/** Roughly a token transfer. Used so the run stage has a concrete price. */
export const REFERENCE_CALL_GAS = 65_000;

/** Ordered better-to-worse, or null where the field has no natural order. */
export type Tone = "good" | "neutral" | "poor";

export interface StageValue {
    chain: ChainId;
    /** The headline figure for this stage, already formatted. */
    value: string;
    /** Sorting key when the field is ordered. Lower is better. */
    rank: number | null;
    tone: Tone;
    /** One line of why this number is what it is. */
    detail: string;
}

export interface StageContent {
    id: JourneyStage;
    label: string;
    /** What the developer is actually asking at this point. */
    question: string;
    /** The parameter that decides it. */
    metric: string;
    /** What changes between chains here. */
    whatChanges: string;
    values: StageValue[];
    /** Honest friction, including Monad's. Keyed by chain so nothing is anonymous. */
    friction: { chain: ChainId; note: string }[];
    /** Deep link into the studio with a sample that demonstrates the stage. */
    studio: { label: string; sample: string } | null;
    source: string;
}

const MONAD_DIFFERENCES = "https://docs.monad.xyz/developer-essentials/differences";
const MONAD_FACTS = "https://docs.monad.xyz/ai/current-facts";
const MONAD_OPCODES = "https://docs.monad.xyz/developer-essentials/opcode-pricing";
const MONAD_GUIDES = "https://docs.monad.xyz/guides/verify-smart-contract/foundry";
const MONAD_INDEXERS = "https://docs.monad.xyz/tooling-and-infra/indexers/";

function durationText(ms: number): string {
    if (ms < 1_000) return `${ms} ms`;
    if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
    if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h`;
    return `${Math.round(ms / 86_400_000)} d`;
}

function usdText(value: number | null): string {
    if (value === null) return "not priced";
    if (value < 0.000001) return "<$0.000001";
    if (value < 0.01) return `$${value.toFixed(6)}`;
    return `$${value.toFixed(4)}`;
}

/** Cost of `gas` units on a chain, in USD, from the live probe. */
function costOf(
    gas: number,
    probe: ChainProbe | undefined,
    nativeUsd: number | null,
): number | null {
    if (probe === undefined || nativeUsd === null) return null;
    const priceWei = effectiveGasPriceWei(probe);
    if (priceWei === null) return null;
    const native = Number((BigInt(gas) * priceWei) / 10n ** 9n) / 1e9;
    return native * nativeUsd;
}

/**
 * Assigns tone by position in the field rather than by identity.
 *
 * Best value in the row is `good`, worst is `poor`, everything between is
 * neutral. When several chains tie at the best value they all read as good,
 * which is the correct answer for a field like "does Foundry work".
 */
function applyTone(values: StageValue[]): StageValue[] {
    const ranked = values.filter((entry) => entry.rank !== null);
    if (ranked.length < 2) return values;

    const best = Math.min(...ranked.map((entry) => entry.rank as number));
    const worst = Math.max(...ranked.map((entry) => entry.rank as number));
    if (best === worst) return values.map((entry) => ({ ...entry, tone: "neutral" }));

    return values.map((entry) => {
        if (entry.rank === null) return entry;
        if (entry.rank === best) return { ...entry, tone: "good" };
        if (entry.rank === worst) return { ...entry, tone: "poor" };
        return { ...entry, tone: "neutral" };
    });
}

export interface JourneyInput {
    chains: readonly ChainProfile[];
    probes: ReadonlyMap<ChainId, ChainProbe>;
    prices: Readonly<Record<string, number>>;
}

function nativeUsdFor(chain: ChainProfile, prices: Readonly<Record<string, number>>): number | null {
    return chain.coingeckoId === null ? null : (prices[chain.coingeckoId] ?? null);
}

export function buildJourney(input: JourneyInput): StageContent[] {
    const { chains, probes, prices } = input;

    // ---- Architect ----
    const architect: StageContent = {
        id: "architect",
        label: "Architect",
        question: "Will the thing I want to build even fit?",
        metric: "Maximum contract size",
        whatChanges:
            "EIP-170 caps a deployed contract at 24 KB almost everywhere, which is the constraint that pushes large systems into proxies and diamonds before a line of business logic is written. Monad raises it to 128 KB.",
        values: applyTone(
            chains.map((chain) => {
                const kb = Math.round(chain.maxCodeSize.value / 1024);
                return {
                    chain: chain.id,
                    value: `${kb} KB`,
                    // Bigger is better here, so rank on the negative.
                    rank: -chain.maxCodeSize.value,
                    tone: "neutral" as Tone,
                    detail:
                        chain.maxCodeSize.value > ETHEREUM_MAX_CODE_SIZE
                            ? "A large system deploys as one contract."
                            : "Anything larger needs a proxy or a diamond split.",
                };
            }),
        ),
        friction: [
            {
                chain: "monad",
                note: "EIP-4844 blobs are not supported, so a design that reads blob hashes needs another data availability path.",
            },
            {
                chain: "monad",
                note: "An EIP-7702 delegated account cannot use CREATE or CREATE2, and cannot be taken below 10 MON.",
            },
        ],
        studio: { label: "Try a contract over 24 KB", sample: "oversized" },
        source: MONAD_DIFFERENCES,
    };

    // ---- Write ----
    const write: StageContent = {
        id: "write",
        label: "Write",
        question: "Do my tools and my libraries still work?",
        metric: "Toolchain parity",
        whatChanges:
            "This is the stage where nothing changes, and that is the point. Every chain here runs the same Solidity, the same OpenZeppelin, and the same Foundry and Hardhat. Porting a contract is a config change, not a rewrite.",
        values: chains.map((chain) => ({
            chain: chain.id,
            value: "Solidity, Foundry, Hardhat, OZ",
            rank: null,
            tone: "neutral" as Tone,
            detail:
                chain.id === "monad"
                    ? "Verification through Sourcify at chain 143."
                    : chain.id === "arbitrum"
                      ? "block.number returns an L1 block number, which breaks contracts assuming L2 cadence."
                      : "Standard EVM tooling.",
        })),
        friction: [
            {
                chain: "arbitrum",
                note: "block.number is the L1 block number, so anything timing on block counts behaves differently.",
            },
            {
                chain: "monad",
                note: "Gas is charged on the limit, so a frontend that lets the wallet estimate and pad is spending real money on the padding.",
            },
        ],
        studio: { label: "Open the studio", sample: "packed" },
        source: MONAD_GUIDES,
    };

    // ---- Test ----
    const test: StageContent = {
        id: "test",
        label: "Test",
        question: "Can I run it, and can I see what happened?",
        metric: "Feedback loop",
        whatChanges:
            "Local testing is identical everywhere: the same forked EVM, the same traces. What differs is how long a testnet round trip takes once you leave your machine, and that is block time.",
        values: applyTone(
            chains.map((chain) => {
                const probe = probes.get(chain.id);
                const blockTime = probe?.blockTimeMs ?? null;
                const ms = blockTime?.value ?? chain.documented.blockTimeMs.value;
                return {
                    chain: chain.id,
                    value: durationText(ms),
                    rank: ms,
                    tone: "neutral" as Tone,
                    detail:
                        blockTime?.basis === "measured"
                            ? "Measured from two real block timestamps."
                            : "Documented; the live probe did not answer.",
                };
            }),
        ),
        friction: [
            {
                chain: "monad",
                note: "Full nodes do not serve arbitrary historical state, so debugging against old blocks needs an archive provider.",
            },
        ],
        studio: null,
        source: MONAD_FACTS,
    };

    // ---- Deploy ----
    const deploy: StageContent = {
        id: "deploy",
        label: "Deploy",
        question: "What does shipping this cost?",
        metric: `Deployment of a ${(REFERENCE_DEPLOY_GAS / 1000).toFixed(0)}k gas contract`,
        whatChanges:
            "Execution gas for a deployment is nearly identical across the EVM. What differs by orders of magnitude is what a unit of gas costs, and that is a live number.",
        values: applyTone(
            chains.map((chain) => {
                const usd = costOf(REFERENCE_DEPLOY_GAS, probes.get(chain.id), nativeUsdFor(chain, prices));
                return {
                    chain: chain.id,
                    value: usdText(usd),
                    rank: usd,
                    tone: "neutral" as Tone,
                    detail:
                        chain.dataFee === "none"
                            ? "Execution gas at the live gas price."
                            : "Execution gas only; this chain also bills for posting calldata to Ethereum.",
                };
            }),
        ),
        friction: [
            {
                chain: "base",
                note: "The L1 data fee is not included here, so the real figure is higher and moves with Ethereum's fee market.",
            },
            {
                chain: "arbitrum",
                note: "The L1 data component often exceeds execution gas for calldata-heavy deployments.",
            },
        ],
        studio: { label: "Price your own contract", sample: "packed" },
        source: MONAD_OPCODES,
    };

    // ---- Run ----
    const run: StageContent = {
        id: "run",
        label: "Run",
        question: "When can I tell the user it is done?",
        metric: "Time to irreversible settlement",
        whatChanges:
            "Every chain here confirms in about a second. The difference is what that confirmation is worth. On a rollup it is a promise from one sequencer, and settlement waits on Ethereum. On Monad two consensus slots make it final.",
        values: applyTone(
            chains.map((chain) => ({
                chain: chain.id,
                value: durationText(chain.hardFinalityMs.value),
                rank: chain.hardFinalityMs.value,
                tone: "neutral" as Tone,
                detail:
                    chain.withdrawalWindowMs !== null
                        ? `Plus ${durationText(chain.withdrawalWindowMs.value)} before funds can leave for Ethereum.`
                        : chain.id === "monad"
                          ? "Deterministic, two slots of MonadBFT."
                          : "Settles on its own validator set.",
            })),
        ),
        friction: [
            {
                chain: "monad",
                note: "Cold account access costs 10,100 gas against 2,600 elsewhere, so a call-heavy contract uses more gas units here.",
            },
            {
                chain: "monad",
                note: "A reverting transaction still pays, because the gas limit is what gets charged.",
            },
        ],
        studio: { label: "Compare a router", sample: "router" },
        source: MONAD_FACTS,
    };

    // ---- Scale ----
    const scale: StageContent = {
        id: "scale",
        label: "Scale",
        question: "What happens when it gets busy?",
        metric: "Gas throughput per second",
        whatChanges:
            "Block gas limit divided by block time is how much computation a chain can actually clear. It is the honest version of a TPS number, because it does not depend on how cheap the transactions being counted were.",
        values: applyTone(
            chains.map((chain) => {
                const probe = probes.get(chain.id);
                const limit = probe?.blockGasLimit?.value ?? chain.documented.blockGasLimit?.value ?? null;
                const ms = probe?.blockTimeMs?.value ?? chain.documented.blockTimeMs.value;
                const perSecond = limit === null ? null : (limit / ms) * 1000;
                return {
                    chain: chain.id,
                    value:
                        perSecond === null
                            ? "not reported"
                            : `${(perSecond / 1_000_000).toFixed(0)}M gas/s`,
                    // Higher is better, so rank on the negative.
                    rank: perSecond === null ? null : -perSecond,
                    tone: "neutral" as Tone,
                    detail:
                        chain.executionModel === "optimistic-parallel"
                            ? "Executes transactions in parallel, so contract layout affects realised throughput."
                            : "Executes sequentially, so a parallel-friendly layout buys nothing here.",
                };
            }),
        ),
        friction: [
            {
                chain: "monad",
                note: "Parallel execution only pays off if your contract's transactions do not collide on the same storage slot. A shared counter serialises everything regardless of the chain's capacity.",
            },
        ],
        studio: { label: "Check your contract's contention", sample: "packed" },
        source: MONAD_FACTS,
    };

    // ---- Observe ----
    const observe: StageContent = {
        id: "observe",
        label: "Observe",
        question: "Can I see what my users did?",
        metric: "Mempool and history",
        whatChanges:
            "Indexers cover every chain here. What differs is whether you can watch transactions before they land, and how far back a plain node will answer for.",
        values: chains.map((chain) => ({
            chain: chain.id,
            value: chain.globalMempool ? "Global mempool" : "No global mempool",
            rank: null,
            tone: "neutral" as Tone,
            detail: chain.globalMempool
                ? "Pending transactions are gossiped network-wide."
                : chain.id === "monad"
                  ? "Transactions go to the next few leaders instead of being broadcast."
                  : "A single sequencer orders transactions; there is no public pending pool.",
        })),
        friction: [
            {
                chain: "monad",
                note: "No global mempool and no arbitrary historical state from full nodes. Tooling that scans pending transactions works differently, and deep history needs an indexer.",
            },
        ],
        studio: null,
        source: MONAD_INDEXERS,
    };

    return [architect, write, test, deploy, run, scale, observe];
}
