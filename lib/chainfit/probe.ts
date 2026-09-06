/**
 * Measures the chain parameters that drift, straight from each chain's public
 * RPC endpoint.
 *
 * Block time, base fee and block gas limit are not constants, and a comparison
 * that hard-codes them is out of date the week it ships. Everything here is
 * read live and stamped with the time it was read, so a reader can tell the
 * difference between a number we measured and a number we were told. When a
 * probe fails the documented value from `chains.ts` is used instead and the
 * result says so, because a stale number that admits it is stale is far more
 * useful than a gap in a table.
 *
 * No API keys: every endpoint used here is a chain's own public RPC.
 */

import { CHAINS, type ChainId, type ChainProfile } from "./chains";

/** How far back to look when measuring block time. */
const BLOCK_SAMPLE_DEPTH = 200;
const RPC_TIMEOUT_MS = 8_000;
const PROBE_TTL_MS = 60_000;
const PRICE_TTL_MS = 300_000;

export type ValueBasis = "measured" | "documented";

export interface MeasuredNumber {
    value: number;
    basis: ValueBasis;
    /** Present when the value was documented rather than measured. */
    source?: string;
}

export interface ChainProbe {
    chain: ChainId;
    reachable: boolean;
    error: string | null;
    /** Chain id the endpoint reports, which should match the registry. */
    reportedChainId: number | null;
    blockNumber: number | null;
    blockTimeMs: MeasuredNumber | null;
    blockGasLimit: MeasuredNumber | null;
    /** Wei per gas, as a decimal string so precision survives JSON. */
    gasPriceWei: string | null;
    baseFeeWei: string | null;
    measuredAt: string;
}

interface RpcResponse {
    result?: unknown;
    error?: { message?: string };
}

/**
 * Some chains report a synthetic block gas limit rather than a real one.
 * Arbitrum, for instance, publishes a value near 2^60. Anything above this
 * bound is treated as unreported rather than shown to a reader as fact.
 */
const PLAUSIBLE_BLOCK_GAS_LIMIT = 10_000_000_000;

async function rpcOnce(url: string, method: string, params: unknown[]): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as RpcResponse;
        if (payload.error) throw new Error(payload.error.message ?? "RPC error");
        return payload.result;
    } finally {
        clearTimeout(timer);
    }
}

/** Tries each endpoint in turn, so one rate-limited provider does not blank a column. */
async function rpc(urls: readonly string[], method: string, params: unknown[]): Promise<unknown> {
    let lastError: unknown = new Error("no endpoint configured");
    for (const url of urls) {
        try {
            return await rpcOnce(url, method, params);
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}

function hexToNumber(value: unknown): number | null {
    if (typeof value !== "string") return null;
    const parsed = Number(BigInt(value));
    return Number.isFinite(parsed) ? parsed : null;
}

function hexToDecimalString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    try {
        return BigInt(value).toString();
    } catch {
        return null;
    }
}

interface BlockHeader {
    number?: string;
    timestamp?: string;
    gasLimit?: string;
    baseFeePerGas?: string;
}

/**
 * Block time from the timestamps of two blocks `BLOCK_SAMPLE_DEPTH` apart.
 *
 * A wide sample is what makes this work on fast chains: block timestamps are
 * second-granular, so consecutive blocks on a 300 ms chain frequently carry the
 * same timestamp and a two-block sample would report zero.
 */
function deriveBlockTimeMs(latest: BlockHeader, older: BlockHeader): number | null {
    const latestTime = hexToNumber(latest.timestamp);
    const olderTime = hexToNumber(older.timestamp);
    const latestNumber = hexToNumber(latest.number);
    const olderNumber = hexToNumber(older.number);
    if (
        latestTime === null ||
        olderTime === null ||
        latestNumber === null ||
        olderNumber === null
    ) {
        return null;
    }
    const blocks = latestNumber - olderNumber;
    const seconds = latestTime - olderTime;
    if (blocks <= 0 || seconds <= 0) return null;
    return Math.round((seconds / blocks) * 1_000);
}

function documented(entry: { value: number; source: string } | null): MeasuredNumber | null {
    if (entry === null) return null;
    return { value: entry.value, basis: "documented", source: entry.source };
}

export async function probeChain(chain: ChainProfile): Promise<ChainProbe> {
    const measuredAt = new Date().toISOString();
    const fallback: ChainProbe = {
        chain: chain.id,
        reachable: false,
        error: null,
        reportedChainId: null,
        blockNumber: null,
        blockTimeMs: documented(chain.documented.blockTimeMs),
        blockGasLimit: documented(chain.documented.blockGasLimit),
        gasPriceWei: null,
        baseFeeWei: null,
        measuredAt,
    };

    try {
        const [chainIdResult, latestResult, gasPriceResult] = await Promise.all([
            rpc(chain.rpcUrls, "eth_chainId", []),
            rpc(chain.rpcUrls, "eth_getBlockByNumber", ["latest", false]),
            rpc(chain.rpcUrls, "eth_gasPrice", []).catch(() => null),
        ]);

        const latest = latestResult as BlockHeader | null;
        if (latest === null || latest.number === undefined) {
            return { ...fallback, error: "no block returned" };
        }

        const latestNumber = hexToNumber(latest.number);
        let blockTime: MeasuredNumber | null = documented(chain.documented.blockTimeMs);
        if (latestNumber !== null && latestNumber > BLOCK_SAMPLE_DEPTH) {
            const olderTag = `0x${(latestNumber - BLOCK_SAMPLE_DEPTH).toString(16)}`;
            const olderResult = await rpc(chain.rpcUrls, "eth_getBlockByNumber", [
                olderTag,
                false,
            ]).catch(() => null);
            const derived =
                olderResult === null
                    ? null
                    : deriveBlockTimeMs(latest, olderResult as BlockHeader);
            if (derived !== null) blockTime = { value: derived, basis: "measured" };
        }

        const rawGasLimit = hexToNumber(latest.gasLimit);
        const gasLimit =
            rawGasLimit !== null && rawGasLimit <= PLAUSIBLE_BLOCK_GAS_LIMIT ? rawGasLimit : null;

        return {
            chain: chain.id,
            reachable: true,
            error: null,
            reportedChainId: hexToNumber(chainIdResult),
            blockNumber: latestNumber,
            blockTimeMs: blockTime,
            blockGasLimit:
                gasLimit === null
                    ? documented(chain.documented.blockGasLimit)
                    : { value: gasLimit, basis: "measured" },
            gasPriceWei: hexToDecimalString(gasPriceResult),
            baseFeeWei: hexToDecimalString(latest.baseFeePerGas),
            measuredAt,
        };
    } catch (error) {
        return {
            ...fallback,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

let probeCache: { at: number; probes: ChainProbe[] } | null = null;

/** Probes every chain concurrently, with a short cache so a page load is cheap. */
export async function probeAll(force = false): Promise<ChainProbe[]> {
    if (!force && probeCache !== null && Date.now() - probeCache.at < PROBE_TTL_MS) {
        return probeCache.probes;
    }
    const probes = await Promise.all(CHAINS.map((chain) => probeChain(chain)));
    probeCache = { at: Date.now(), probes };
    return probes;
}

// ============= NATIVE TOKEN PRICING =============

export interface NativePrices {
    /** CoinGecko id to USD. Missing ids simply have no entry. */
    usd: Record<string, number>;
    fetchedAt: string;
    available: boolean;
}

let priceCache: { at: number; prices: NativePrices } | null = null;

/**
 * USD prices for the native tokens, from CoinGecko's keyless endpoint.
 *
 * Pricing is a convenience, not a dependency. When it is unavailable the report
 * still shows gas units and native-token amounts, which are the figures that
 * actually compare execution environments; the dollar column is what makes them
 * legible to a product manager.
 */
export async function fetchNativePrices(force = false): Promise<NativePrices> {
    if (!force && priceCache !== null && Date.now() - priceCache.at < PRICE_TTL_MS) {
        return priceCache.prices;
    }

    const ids = Array.from(
        new Set(CHAINS.map((chain) => chain.coingeckoId).filter((id): id is string => id !== null)),
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    try {
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as Record<string, { usd?: number }>;
        const usd: Record<string, number> = {};
        for (const [id, entry] of Object.entries(payload)) {
            if (typeof entry.usd === "number") usd[id] = entry.usd;
        }
        const prices: NativePrices = {
            usd,
            fetchedAt: new Date().toISOString(),
            available: Object.keys(usd).length > 0,
        };
        priceCache = { at: Date.now(), prices };
        return prices;
    } catch {
        const prices: NativePrices = {
            usd: {},
            fetchedAt: new Date().toISOString(),
            available: false,
        };
        priceCache = { at: Date.now(), prices };
        return prices;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Effective price per gas in wei.
 *
 * `eth_gasPrice` is preferred over the block's base fee because it includes the
 * priority tip a transaction actually needs to get included. On BNB Chain the
 * base fee is zero while the real price is 0.05 gwei, so quoting the base fee
 * would report a free chain.
 */
export function effectiveGasPriceWei(probe: ChainProbe): bigint | null {
    const source = probe.gasPriceWei ?? probe.baseFeeWei;
    if (source === null) return null;
    try {
        return BigInt(source);
    } catch {
        return null;
    }
}

/**
 * Cost of `gas` units in native token.
 *
 * Scaled to 1e-12 of a token before the integer division rather than to gwei.
 * Dividing straight to gwei threw away up to a full gwei, which is around
 * 1e-6 USD on Ethereum: invisible against a dollar, but the reports quote
 * fractions of a cent to six places, so it was landing in a digit we print.
 * At this scale the truncation is below 1e-8 USD on every chain compared, and
 * a payload small enough to round to zero no longer does.
 */
export function gasCostNative(gas: number, priceWei: bigint): number {
    const PRECISION = 1_000_000_000_000n;
    const scaled = (BigInt(Math.round(gas)) * priceWei * PRECISION) / 10n ** 18n;
    return Number(scaled) / Number(PRECISION);
}
