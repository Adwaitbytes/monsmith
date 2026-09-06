/**
 * Gas schedules for the EVM variants Monsmith compares.
 *
 * Monad keeps Ethereum's gas costs everywhere except four places: cold state
 * access, the granularity at which storage is warmed, four precompiles, and
 * memory expansion. That is the whole difference, and it is why this file only
 * models those four categories rather than reimplementing a gas schedule. The
 * rest of a contract's cost is taken from a real EVM execution, so anything not
 * listed here is identical on both chains by construction.
 *
 * Every number below comes from the Monad opcode pricing specification (MIP-8,
 * revision MONAD_TEN). The `MONAD_COST_EXAMPLES` table at the bottom is copied
 * verbatim from that document and is exercised as a test, so a spec change that
 * we have not noticed shows up as a failing assertion rather than a wrong number
 * in a report.
 *
 * @see https://docs.monad.xyz/developer-essentials/opcode-pricing
 */

/** Warm account and warm storage access. Identical on both chains. */
export const WARM_ACCESS_GAS = 100;

/** Cold account access: BALANCE, EXTCODE*, CALL family, SELFDESTRUCT. */
export const ETHEREUM_COLD_ACCOUNT_GAS = 2_600;
export const MONAD_COLD_ACCOUNT_GAS = 10_100;

/** Cold SLOAD on Ethereum is charged per slot. */
export const ETHEREUM_COLD_SLOAD_GAS = 2_100;

/**
 * Monad warms storage a page at a time. A page is 128 consecutive slots, and a
 * slot's page is its index with the low 7 bits stripped.
 */
export const MONAD_PAGE_SLOTS = 128n;
export const MONAD_PAGE_SHIFT = 7n;

/** Charged once per page, on the first access of any kind (read or write). */
export const MONAD_PAGE_LOAD_GAS = 8_000;
/** Charged once per page, on the first SSTORE to it that changes a value. */
export const MONAD_PAGE_WRITE_GAS = 2_800;
/** Charged each time a page's net slot count reaches a new high in the transaction. */
export const MONAD_STATE_GROWTH_GAS = 17_000;

/** Ethereum's SSTORE constants, kept for the static estimator. */
export const ETHEREUM_SSTORE_SET_GAS = 20_000;
export const ETHEREUM_SSTORE_RESET_GAS = 2_900;

/** A transaction may touch at most 8 MB of memory on Monad. */
export const MONAD_MEMORY_LIMIT_BYTES = 8_388_608;
/** Expanding all the way to that cap costs this much, per the spec. */
export const MONAD_MEMORY_LIMIT_GAS = 131_072;

/** EIP-170 and EIP-3860 limits, which Monad raises. */
export const ETHEREUM_MAX_CODE_SIZE = 24_576;
export const ETHEREUM_MAX_INITCODE_SIZE = 49_152;
export const MONAD_MAX_CODE_SIZE = 131_072;
export const MONAD_MAX_INITCODE_SIZE = 262_144;

/** Balance an EIP-7702-delegated EOA may not be pushed below. */
export const MONAD_USER_RESERVE_BALANCE_MON = 10;

/** Intrinsic transaction costs. Identical on both chains. */
export const TX_BASE_GAS = 21_000;
/**
 * Additional intrinsic cost of a transaction that creates a contract
 * (Gtxcreate in the yellow paper). Charged on top of the base 21,000 and
 * separate from the EIP-3860 per-word init code charge, which is easy to
 * conflate and was the source of a 32,000 gas undercount on every deployment.
 */
export const TX_CREATE_GAS = 32_000;
export const CALLDATA_ZERO_BYTE_GAS = 4;
export const CALLDATA_NONZERO_BYTE_GAS = 16;

export type ScheduleId = "ethereum" | "monad";

/**
 * Precompiles Monad reprices. Each is a flat multiplier on the precompile's
 * total Ethereum cost, including any per-point or per-round component, which is
 * what lets `precompileSurcharge` work from the Ethereum cost alone.
 */
export const MONAD_PRECOMPILE_MULTIPLIERS: Readonly<Record<number, number>> = {
    0x01: 2, // ecRecover
    0x06: 2, // ecAdd
    0x07: 5, // ecMul
    0x08: 5, // ecPairing
    0x09: 2, // blake2f
    0x0a: 4, // point evaluation
};

export const PRECOMPILE_NAMES: Readonly<Record<number, string>> = {
    0x01: "ecRecover",
    0x02: "sha256",
    0x03: "ripemd160",
    0x04: "identity",
    0x05: "modexp",
    0x06: "ecAdd",
    0x07: "ecMul",
    0x08: "ecPairing",
    0x09: "blake2f",
    0x0a: "pointEvaluation",
};

/** The page a slot belongs to. `page_index = slot >> 7`. */
export function pageIndex(slot: bigint): bigint {
    return slot >> MONAD_PAGE_SHIFT;
}

/**
 * Total memory expansion cost for a frame that reached `words` 32-byte words.
 *
 * Expansion is charged incrementally as memory grows, but the increments
 * telescope: the sum of every expansion within a frame equals the formula
 * applied to the frame's high-water mark. Charging from the maximum is
 * therefore exact, not an approximation.
 */
export function memoryGas(words: number, schedule: ScheduleId): number {
    if (words <= 0) return 0;
    if (schedule === "monad") return Math.floor(words / 2);
    return 3 * words + Math.floor((words * words) / 512);
}

/** Extra gas Monad charges for a precompile that cost `ethereumGas` on Ethereum. */
export function precompileSurcharge(address: number, ethereumGas: number): number {
    const multiplier = MONAD_PRECOMPILE_MULTIPLIERS[address];
    if (multiplier === undefined) return 0;
    return ethereumGas * (multiplier - 1);
}

/** Cold account access cost under a schedule. */
export function coldAccountGas(schedule: ScheduleId): number {
    return schedule === "monad" ? MONAD_COLD_ACCOUNT_GAS : ETHEREUM_COLD_ACCOUNT_GAS;
}

// ============= STORAGE ACCESS MODELS =============

export interface StorageAccess {
    /** Lowercase hex address of the account whose storage is being touched. */
    account: string;
    slot: bigint;
    kind: "load" | "store";
    /** Store only: the write turns a zero slot non-zero. */
    createsSlot: boolean;
    /** Store only: the write turns a non-zero slot zero. */
    clearsSlot: boolean;
    /** Store only: the written value differs from the value already there. */
    changesValue: boolean;
}

export interface AccountAccess {
    address: string;
    opcode: string;
}

interface PageState {
    loaded: boolean;
    written: boolean;
    /** Net slots created minus cleared, within this transaction. */
    netSlots: number;
    /** Highest `netSlots` reached so far. Growth is charged on new highs. */
    highWater: number;
}

/**
 * Monad storage cost for an ordered sequence of accesses.
 *
 * SLOAD  = 100 + 8000 if this is the page's first access.
 * SSTORE = 100
 *        + 8000  if this is the page's first access, read or write
 *        + 2800  if this is the first value-changing store to the page
 *        + 17000 each time the page's net slot count reaches a new high.
 *
 * State growth is a high-water mark rather than a running count, so a slot
 * created to replace one cleared earlier in the same transaction is free.
 */
export function monadStorageGas(accesses: readonly StorageAccess[]): number {
    const pages = new Map<string, PageState>();
    let total = 0;

    for (const access of accesses) {
        const key = `${access.account}:${pageIndex(access.slot)}`;
        let page = pages.get(key);
        if (page === undefined) {
            page = { loaded: false, written: false, netSlots: 0, highWater: 0 };
            pages.set(key, page);
        }

        total += WARM_ACCESS_GAS;

        if (!page.loaded) {
            total += MONAD_PAGE_LOAD_GAS;
            page.loaded = true;
        }

        if (access.kind === "load") continue;

        if (access.changesValue && !page.written) {
            total += MONAD_PAGE_WRITE_GAS;
            page.written = true;
        }

        if (access.createsSlot) page.netSlots += 1;
        if (access.clearsSlot) page.netSlots -= 1;

        if (page.netSlots > page.highWater) {
            total += MONAD_STATE_GROWTH_GAS * (page.netSlots - page.highWater);
            page.highWater = page.netSlots;
        }
    }

    return total;
}

/**
 * Ethereum storage cost for the same sequence, used by the static estimator and
 * as a cross-check on traced executions. Refunds are excluded; they are reported
 * separately because Monad's model has no equivalent.
 */
export function ethereumStorageGas(accesses: readonly StorageAccess[]): number {
    const warm = new Set<string>();
    let total = 0;

    for (const access of accesses) {
        const key = `${access.account}:${access.slot}`;
        const cold = !warm.has(key);
        if (cold) warm.add(key);

        if (access.kind === "load") {
            total += cold ? ETHEREUM_COLD_SLOAD_GAS : WARM_ACCESS_GAS;
            continue;
        }

        if (cold) total += ETHEREUM_COLD_SLOAD_GAS;
        if (!access.changesValue) total += WARM_ACCESS_GAS;
        else if (access.createsSlot) total += ETHEREUM_SSTORE_SET_GAS;
        else total += ETHEREUM_SSTORE_RESET_GAS;
    }

    return total;
}

/** Cold/warm account access cost for an ordered sequence, under one schedule. */
export function accountAccessGas(
    accesses: readonly AccountAccess[],
    schedule: ScheduleId,
): number {
    const warm = new Set<string>();
    const cold = coldAccountGas(schedule);
    let total = 0;

    for (const access of accesses) {
        if (warm.has(access.address)) {
            total += WARM_ACCESS_GAS;
        } else {
            warm.add(access.address);
            total += cold;
        }
    }

    return total;
}

/** Intrinsic cost of a transaction carrying `data`. Same on both chains. */
export function intrinsicGas(data: Uint8Array, isCreate: boolean): number {
    let zero = 0;
    let nonZero = 0;
    for (const byte of data) {
        if (byte === 0) zero += 1;
        else nonZero += 1;
    }
    const calldata = zero * CALLDATA_ZERO_BYTE_GAS + nonZero * CALLDATA_NONZERO_BYTE_GAS;
    // EIP-3860 charges 2 gas per 32-byte word of init code, on top of calldata.
    const initCode = isCreate ? 2 * Math.ceil(data.length / 32) : 0;
    const create = isCreate ? TX_CREATE_GAS : 0;
    return TX_BASE_GAS + create + calldata + initCode;
}

/**
 * The worked examples from the Monad opcode pricing page, in the order they
 * appear there. Kept next to the model so the two cannot drift apart.
 */
export const MONAD_COST_EXAMPLES: ReadonlyArray<{
    description: string;
    accesses: StorageAccess[];
    expectedGas: number;
}> = [
    {
        description: "SLOAD a slot, first access to its page",
        accesses: [store("load", 0n)],
        expectedGas: 8_100,
    },
    {
        description: "SLOAD another slot in the same page",
        accesses: [store("load", 0n), store("load", 1n)],
        expectedGas: 8_100 + 100,
    },
    {
        description: "SSTORE a fresh slot, first access to its page",
        accesses: [{ ...store("store", 0n), createsSlot: true, changesValue: true }],
        expectedGas: 27_900,
    },
    {
        description: "SSTORE a fresh slot in a page already written",
        accesses: [
            { ...store("store", 0n), createsSlot: true, changesValue: true },
            { ...store("store", 1n), createsSlot: true, changesValue: true },
        ],
        expectedGas: 27_900 + 17_100,
    },
    {
        description: "SSTORE over a non-zero slot, first access to its page",
        accesses: [{ ...store("store", 0n), changesValue: true }],
        expectedGas: 10_900,
    },
    {
        description: "SSTORE over a non-zero slot in a page already written",
        accesses: [
            { ...store("store", 0n), changesValue: true },
            { ...store("store", 1n), changesValue: true },
        ],
        expectedGas: 10_900 + 100,
    },
];

function store(kind: "load" | "store", slot: bigint): StorageAccess {
    return {
        account: "0xcontract",
        slot,
        kind,
        createsSlot: false,
        clearsSlot: false,
        changesValue: false,
    };
}
