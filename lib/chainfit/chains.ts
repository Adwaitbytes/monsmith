/**
 * The EVM chains a Chain Fit report compares, and the facts about each one.
 *
 * Two kinds of fact live here, and they are deliberately kept apart:
 *
 *   Protocol constants - code size limits, how gas is charged, the finality
 *   model - are hard-coded with a `source` link, because they only change at a
 *   hard fork and a reader needs to be able to check them.
 *
 *   Anything that drifts - block time, base fee, block gas limit - is NOT here.
 *   It is measured from each chain's public RPC at request time by `probe.ts`.
 *   The `documented` values below are only a fallback for when a probe fails,
 *   and the UI says which of the two it is showing.
 *
 * Quoting a measured number beats quoting a marketing number, and quoting a
 * cited constant beats quoting a remembered one. Nothing in a report should be
 * neither measured nor cited.
 */

import {
    ETHEREUM_MAX_CODE_SIZE,
    ETHEREUM_MAX_INITCODE_SIZE,
    MONAD_MAX_CODE_SIZE,
    MONAD_MAX_INITCODE_SIZE,
    type ScheduleId,
} from "./schedules";

export type ChainId =
    | "monad"
    | "ethereum"
    | "base"
    | "arbitrum"
    | "optimism"
    | "polygon"
    | "bnb";

/** How the chain orders and runs the transactions in a block. */
export type ExecutionModel = "sequential" | "optimistic-parallel";

/** What the sender's balance is debited for. */
export type GasCharging = "gas_used" | "gas_limit";

/** Where the chain's security ultimately comes from. */
export type SettlementModel = "l1" | "optimistic-rollup" | "sidechain";

/** Extra per-transaction cost for publishing data to a parent chain. */
export type DataFeeModel = "none" | "op-stack" | "arbitrum";

export interface SourcedNumber {
    value: number;
    source: string;
}

export interface ChainProfile {
    id: ChainId;
    name: string;
    /** Short label for dense table headers. */
    shortName: string;
    chainId: number;
    /**
     * Public endpoints that need no API key, tried in order. More than one
     * because free endpoints rate-limit and occasionally start demanding a key.
     */
    rpcUrls: readonly string[];
    explorer: string;
    currencySymbol: string;
    /** CoinGecko id for USD pricing, or null when we cannot price it. */
    coingeckoId: string | null;
    /** Brand colour, used for the comparison charts. */
    accent: string;

    executionModel: ExecutionModel;
    gasSchedule: ScheduleId;
    gasCharging: GasCharging;
    settlement: SettlementModel;
    dataFee: DataFeeModel;

    maxCodeSize: SourcedNumber;
    /** Null where the chain does not publish a documented limit. */
    maxInitCodeSize: SourcedNumber | null;

    /** Documented fallbacks. `probe.ts` supersedes these when it can. */
    documented: {
        blockTimeMs: SourcedNumber;
        blockGasLimit: SourcedNumber | null;
        txGasLimit: SourcedNumber | null;
    };

    /** How long until an app can reasonably show the user "done". */
    softFinalityMs: SourcedNumber;
    /** How long until the result cannot be reversed without trusting an operator. */
    hardFinalityMs: SourcedNumber;
    /** Optimistic rollups only: the challenge window before an L1 withdrawal lands. */
    withdrawalWindowMs: SourcedNumber | null;

    /** Whether pending transactions are visible network-wide before inclusion. */
    globalMempool: boolean;
    /** EIP-4844 blob transaction support. */
    blobs: boolean;

    /** Things a developer should know that count against this chain. */
    caveats: string[];
}

const MONAD_DIFFERENCES_DOCS = "https://docs.monad.xyz/developer-essentials/differences";
const MONAD_FACTS_DOCS = "https://docs.monad.xyz/ai/current-facts";
const EIP_170 = "https://eips.ethereum.org/EIPS/eip-170";
const EIP_3860 = "https://eips.ethereum.org/EIPS/eip-3860";

export const CHAINS: readonly ChainProfile[] = [
    {
        id: "monad",
        name: "Monad",
        shortName: "Monad",
        chainId: 143,
        rpcUrls: ["https://rpc.monad.xyz"],
        explorer: "https://monadvision.com",
        currencySymbol: "MON",
        coingeckoId: "monad",
        accent: "#836EF9",
        executionModel: "optimistic-parallel",
        gasSchedule: "monad",
        gasCharging: "gas_limit",
        settlement: "l1",
        dataFee: "none",
        maxCodeSize: { value: MONAD_MAX_CODE_SIZE, source: MONAD_DIFFERENCES_DOCS },
        maxInitCodeSize: { value: MONAD_MAX_INITCODE_SIZE, source: MONAD_DIFFERENCES_DOCS },
        documented: {
            blockTimeMs: { value: 300, source: MONAD_FACTS_DOCS },
            blockGasLimit: { value: 150_000_000, source: MONAD_FACTS_DOCS },
            txGasLimit: { value: 30_000_000, source: MONAD_FACTS_DOCS },
        },
        softFinalityMs: { value: 300, source: MONAD_FACTS_DOCS },
        hardFinalityMs: { value: 600, source: MONAD_FACTS_DOCS },
        withdrawalWindowMs: null,
        globalMempool: false,
        blobs: false,
        caveats: [
            "Gas is charged on the transaction's gas limit, not the gas it uses, so a padded limit is money spent.",
            "Cold account access costs 10,100 gas against 2,600 elsewhere, which makes call-heavy contracts use more gas units.",
            "There is no global mempool. Transactions are forwarded to the next few leaders instead.",
            "EIP-4844 blob transactions are not supported.",
            "Full nodes do not serve arbitrary historical state, so some indexing patterns need an archive provider.",
            "EIP-7702 delegated accounts cannot be taken below 10 MON and cannot use CREATE or CREATE2.",
            "The ecosystem is younger than the established L2s, so fewer battle-tested integrations exist.",
        ],
    },
    {
        id: "ethereum",
        name: "Ethereum",
        shortName: "Ethereum",
        chainId: 1,
        rpcUrls: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"],
        explorer: "https://etherscan.io",
        currencySymbol: "ETH",
        coingeckoId: "ethereum",
        accent: "#627EEA",
        executionModel: "sequential",
        gasSchedule: "ethereum",
        gasCharging: "gas_used",
        settlement: "l1",
        dataFee: "none",
        maxCodeSize: { value: ETHEREUM_MAX_CODE_SIZE, source: EIP_170 },
        maxInitCodeSize: { value: ETHEREUM_MAX_INITCODE_SIZE, source: EIP_3860 },
        documented: {
            blockTimeMs: { value: 12_000, source: "https://ethereum.org/en/developers/docs/blocks/" },
            blockGasLimit: { value: 60_000_000, source: "https://etherscan.io/chart/gaslimit" },
            txGasLimit: null,
        },
        softFinalityMs: {
            value: 12_000,
            source: "https://ethereum.org/en/developers/docs/consensus-mechanisms/pos/",
        },
        hardFinalityMs: {
            value: 768_000,
            source: "https://ethereum.org/en/developers/docs/consensus-mechanisms/pos/#finality",
        },
        withdrawalWindowMs: null,
        globalMempool: true,
        blobs: true,
        caveats: [
            "The most expensive execution environment of the group by a wide margin.",
            "Two epochs, roughly 12.8 minutes, before a block is economically final.",
            "24 KB contract size limit forces large systems into proxies or diamonds.",
        ],
    },
    {
        id: "base",
        name: "Base",
        shortName: "Base",
        chainId: 8453,
        rpcUrls: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
        explorer: "https://basescan.org",
        currencySymbol: "ETH",
        coingeckoId: "ethereum",
        accent: "#0052FF",
        executionModel: "sequential",
        gasSchedule: "ethereum",
        gasCharging: "gas_used",
        settlement: "optimistic-rollup",
        dataFee: "op-stack",
        maxCodeSize: { value: ETHEREUM_MAX_CODE_SIZE, source: EIP_170 },
        maxInitCodeSize: { value: ETHEREUM_MAX_INITCODE_SIZE, source: EIP_3860 },
        documented: {
            blockTimeMs: { value: 2_000, source: "https://docs.base.org/network-information" },
            blockGasLimit: null,
            txGasLimit: null,
        },
        softFinalityMs: {
            value: 200,
            source: "https://docs.base.org/base-chain/flashblocks/apps",
        },
        hardFinalityMs: {
            value: 768_000,
            source: "https://docs.base.org/base-chain/network-information",
        },
        withdrawalWindowMs: {
            value: 604_800_000,
            source: "https://docs.base.org/base-chain/bridges/network-bridge",
        },
        globalMempool: false,
        blobs: false,
        caveats: [
            "A single sequencer orders every transaction, so liveness depends on one operator.",
            "Each transaction pays an L1 data fee on top of execution gas, which dominates for calldata-heavy calls.",
            "Withdrawals to Ethereum sit behind a seven-day challenge window.",
            "Execution is sequential, so a parallel-friendly contract layout buys nothing.",
        ],
    },
    {
        id: "arbitrum",
        name: "Arbitrum One",
        shortName: "Arbitrum",
        chainId: 42161,
        rpcUrls: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"],
        explorer: "https://arbiscan.io",
        currencySymbol: "ETH",
        coingeckoId: "ethereum",
        accent: "#12AAFF",
        executionModel: "sequential",
        gasSchedule: "ethereum",
        gasCharging: "gas_used",
        settlement: "optimistic-rollup",
        dataFee: "arbitrum",
        maxCodeSize: {
            value: ETHEREUM_MAX_CODE_SIZE,
            source: "https://docs.arbitrum.io/arbitrum-ethereum-differences",
        },
        maxInitCodeSize: null,
        documented: {
            blockTimeMs: { value: 250, source: "https://docs.arbitrum.io/arbitrum-essentials/arbitrum-vs-ethereum/block-numbers-and-time" },
            blockGasLimit: null,
            txGasLimit: null,
        },
        softFinalityMs: {
            value: 250,
            source: "https://docs.arbitrum.io/arbitrum-essentials/arbitrum-vs-ethereum/block-numbers-and-time",
        },
        hardFinalityMs: {
            value: 768_000,
            source: "https://docs.arbitrum.io/how-arbitrum-works/state-transition-function/ethereum-vs-arbitrum",
        },
        withdrawalWindowMs: {
            value: 604_800_000,
            source: "https://docs.arbitrum.io/arbitrum-bridge/quickstart",
        },
        globalMempool: false,
        blobs: false,
        caveats: [
            "`block.number` returns an L1 block number, which breaks contracts that assume L2 block cadence.",
            "Transactions pay an L1 data component that is often larger than execution gas.",
            "A single sequencer orders every transaction.",
            "Withdrawals to Ethereum sit behind a seven-day challenge window.",
            "Execution is sequential, so a parallel-friendly contract layout buys nothing.",
        ],
    },
    {
        id: "optimism",
        name: "OP Mainnet",
        shortName: "Optimism",
        chainId: 10,
        rpcUrls: ["https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com"],
        explorer: "https://optimistic.etherscan.io",
        currencySymbol: "ETH",
        coingeckoId: "ethereum",
        accent: "#FF0420",
        executionModel: "sequential",
        gasSchedule: "ethereum",
        gasCharging: "gas_used",
        settlement: "optimistic-rollup",
        dataFee: "op-stack",
        maxCodeSize: { value: ETHEREUM_MAX_CODE_SIZE, source: EIP_170 },
        maxInitCodeSize: { value: ETHEREUM_MAX_INITCODE_SIZE, source: EIP_3860 },
        documented: {
            blockTimeMs: { value: 2_000, source: "https://docs.optimism.io/superchain/networks" },
            blockGasLimit: null,
            txGasLimit: null,
        },
        softFinalityMs: { value: 2_000, source: "https://docs.optimism.io/superchain/networks" },
        hardFinalityMs: {
            value: 768_000,
            source: "https://docs.optimism.io/stack/rollup/overview",
        },
        withdrawalWindowMs: {
            value: 604_800_000,
            source: "https://docs.optimism.io/app-developers/bridging/messaging",
        },
        globalMempool: false,
        blobs: false,
        caveats: [
            "A single sequencer orders every transaction.",
            "Each transaction pays an L1 data fee on top of execution gas.",
            "Withdrawals to Ethereum sit behind a seven-day challenge window.",
            "Execution is sequential, so a parallel-friendly contract layout buys nothing.",
        ],
    },
    {
        id: "polygon",
        name: "Polygon PoS",
        shortName: "Polygon",
        chainId: 137,
        rpcUrls: ["https://polygon-bor-rpc.publicnode.com", "https://1rpc.io/matic"],
        explorer: "https://polygonscan.com",
        currencySymbol: "POL",
        coingeckoId: "polygon-ecosystem-token",
        accent: "#8247E5",
        executionModel: "sequential",
        gasSchedule: "ethereum",
        gasCharging: "gas_used",
        settlement: "sidechain",
        dataFee: "none",
        maxCodeSize: { value: ETHEREUM_MAX_CODE_SIZE, source: EIP_170 },
        maxInitCodeSize: { value: ETHEREUM_MAX_INITCODE_SIZE, source: EIP_3860 },
        documented: {
            blockTimeMs: { value: 2_000, source: "https://docs.polygon.technology/pos/" },
            blockGasLimit: null,
            txGasLimit: null,
        },
        softFinalityMs: { value: 2_000, source: "https://docs.polygon.technology/pos/" },
        hardFinalityMs: { value: 5_000, source: "https://polygon.technology/blog/polygon-rio-upgrade-is-live-on-mainnet" },
        withdrawalWindowMs: null,
        globalMempool: true,
        blobs: false,
        caveats: [
            "Security comes from its own validator set rather than from Ethereum.",
            "Execution is sequential, so a parallel-friendly contract layout buys nothing.",
            "Historically prone to reorgs of several blocks under load.",
        ],
    },
    {
        id: "bnb",
        name: "BNB Smart Chain",
        shortName: "BNB",
        chainId: 56,
        rpcUrls: ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"],
        explorer: "https://bscscan.com",
        currencySymbol: "BNB",
        coingeckoId: "binancecoin",
        accent: "#F0B90B",
        executionModel: "sequential",
        gasSchedule: "ethereum",
        gasCharging: "gas_used",
        settlement: "sidechain",
        dataFee: "none",
        maxCodeSize: { value: ETHEREUM_MAX_CODE_SIZE, source: EIP_170 },
        maxInitCodeSize: { value: ETHEREUM_MAX_INITCODE_SIZE, source: EIP_3860 },
        documented: {
            blockTimeMs: { value: 750, source: "https://www.bnbchain.org/en/blog/bnb-chain-maxwell-hardfork" },
            blockGasLimit: null,
            txGasLimit: null,
        },
        softFinalityMs: { value: 750, source: "https://www.bnbchain.org/en/blog/bnb-chain-maxwell-hardfork" },
        hardFinalityMs: { value: 1_875, source: "https://www.bnbchain.org/en/blog/bnb-chain-maxwell-hardfork" },
        withdrawalWindowMs: null,
        globalMempool: true,
        blobs: true,
        caveats: [
            "A small validator set relative to Ethereum.",
            "Execution is sequential, so a parallel-friendly contract layout buys nothing.",
        ],
    },
];

export const CHAIN_BY_ID: ReadonlyMap<ChainId, ChainProfile> = new Map(
    CHAINS.map((chain) => [chain.id, chain]),
);

export function getChain(id: ChainId): ChainProfile {
    const chain = CHAIN_BY_ID.get(id);
    if (chain === undefined) throw new Error(`Unknown chain: ${id}`);
    return chain;
}

/** The chain a Chain Fit report is written from the point of view of. */
export const HOME_CHAIN: ChainId = "monad";

/** Default comparison set: where EVM contracts actually come from today. */
export const DEFAULT_COMPARISON: readonly ChainId[] = [
    "monad",
    "ethereum",
    "base",
    "arbitrum",
    "polygon",
    "bnb",
];

export function isChainId(value: string): value is ChainId {
    return CHAIN_BY_ID.has(value as ChainId);
}
