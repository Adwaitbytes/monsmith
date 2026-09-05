/**
 * Turns one traced execution into a gas figure for each chain being compared.
 *
 * The comparison is expressed as a delta rather than as two independent
 * calculations, and that is deliberate. Ethereum's number comes from a real EVM
 * run and is exact. Monad's number is that same figure with four adjustments:
 *
 *     monad = ethereum
 *           + (monad storage        - ethereum storage)
 *           + (monad account access - ethereum account access)
 *           + (monad memory         - ethereum memory)
 *           + precompile surcharges
 *
 * Everything the two chains price identically cancels and never has to be
 * modelled at all. Where a term does appear on both sides it is computed from
 * the same observations, so a missed observation shifts both halves and mostly
 * cancels too. The alternative, decomposing the Ethereum total into components
 * and rebuilding it, would let any modelling error land undiluted in the answer.
 */

import type { ChainId, ChainProfile } from "./chains";
import {
    accountAccessGas,
    ethereumStorageGas,
    memoryGas,
    monadStorageGas,
    precompileSurcharge,
    type ScheduleId,
} from "./schedules";
import type { ExecutionTrace } from "./trace";

export interface GasDelta {
    storage: number;
    accountAccess: number;
    memory: number;
    precompiles: number;
    total: number;
}

export interface ChainGas {
    chain: ChainId;
    /** Gas consumed executing the call. */
    executionGas: number;
    /** Gas for getting the transaction into a block at all. */
    intrinsicGas: number;
    /** Execution plus intrinsic. What the chain charges gas on. */
    totalGas: number;
    /**
     * Difference from the Ethereum baseline, by component. Zero on chains that
     * use the Ethereum schedule.
     */
    delta: GasDelta;
    /**
     * Whether the Ethereum storage term was measured from the EVM or modelled.
     * Reported rather than hidden, because it bounds how much a reader should
     * trust the comparison.
     */
    storageBasis: "measured" | "modelled";
}

const ZERO_DELTA: GasDelta = {
    storage: 0,
    accountAccess: 0,
    memory: 0,
    precompiles: 0,
    total: 0,
};

function totalMemoryGas(frameWords: readonly number[], schedule: ScheduleId): number {
    let total = 0;
    for (const words of frameWords) total += memoryGas(words, schedule);
    return total;
}

/**
 * Ethereum's storage cost for this trace: measured where the EVM let us observe
 * every charge, modelled otherwise.
 */
export function ethereumStorageCost(trace: ExecutionTrace): {
    gas: number;
    basis: "measured" | "modelled";
} {
    if (trace.observedStorageGas !== null) {
        return { gas: trace.observedStorageGas, basis: "measured" };
    }
    return { gas: ethereumStorageGas(trace.storageAccesses), basis: "modelled" };
}

/** The four adjustments that turn an Ethereum gas figure into a Monad one. */
export function monadDelta(trace: ExecutionTrace): GasDelta {
    const ethereumStorage = ethereumStorageCost(trace).gas;
    const storage = monadStorageGas(trace.storageAccesses) - ethereumStorage;

    const accountAccess =
        accountAccessGas(trace.accountAccesses, "monad") -
        accountAccessGas(trace.accountAccesses, "ethereum");

    const memory =
        totalMemoryGas(trace.frameMemoryWords, "monad") -
        totalMemoryGas(trace.frameMemoryWords, "ethereum");

    let precompiles = 0;
    for (const call of trace.precompileCalls) {
        precompiles += precompileSurcharge(call.address, call.ethereumGas);
    }

    return {
        storage,
        accountAccess,
        memory,
        precompiles,
        total: storage + accountAccess + memory + precompiles,
    };
}

/** Gas this trace would consume on `chain`. */
export function repriceTrace(trace: ExecutionTrace, chain: ChainProfile): ChainGas {
    const { basis } = ethereumStorageCost(trace);

    if (chain.gasSchedule !== "monad") {
        return {
            chain: chain.id,
            executionGas: trace.ethereumExecutionGas,
            intrinsicGas: trace.intrinsicGas,
            totalGas: trace.ethereumExecutionGas + trace.intrinsicGas,
            delta: ZERO_DELTA,
            storageBasis: basis,
        };
    }

    const delta = monadDelta(trace);
    const executionGas = trace.ethereumExecutionGas + delta.total;
    return {
        chain: chain.id,
        executionGas,
        intrinsicGas: trace.intrinsicGas,
        totalGas: executionGas + trace.intrinsicGas,
        delta,
        storageBasis: basis,
    };
}

export interface DeltaExplanation {
    component: "storage" | "accountAccess" | "memory" | "precompiles";
    gas: number;
    label: string;
    detail: string;
}

/** Human-readable account of why the Monad figure differs, largest effect first. */
export function explainDelta(trace: ExecutionTrace, delta: GasDelta): DeltaExplanation[] {
    const coldAccounts = new Set(trace.accountAccesses.map((access) => access.address)).size;
    const pages = new Set(
        trace.storageAccesses.map((access) => `${access.account}:${access.slot >> 7n}`),
    ).size;
    const slots = new Set(
        trace.storageAccesses.map((access) => `${access.account}:${access.slot}`),
    ).size;
    const peakWords = trace.frameMemoryWords.reduce((max, words) => Math.max(max, words), 0);

    const explanations: DeltaExplanation[] = [
        {
            component: "storage",
            gas: delta.storage,
            label:
                delta.storage <= 0
                    ? "Storage warms a page at a time"
                    : "Storage pages cost more than they save here",
            detail:
                `${slots} slot${slots === 1 ? "" : "s"} across ${pages} page${pages === 1 ? "" : "s"}. ` +
                (delta.storage <= 0
                    ? "Monad pays 8,100 gas once per 128-slot page instead of 2,100 per slot, so slots that sit together are close to free after the first."
                    : "Monad pays 8,100 gas per page touched, and these slots are spread thinly enough that the page charge is not amortised."),
        },
        {
            component: "accountAccess",
            gas: delta.accountAccess,
            label: "Cold account access is repriced",
            detail: `${coldAccounts} distinct address${coldAccounts === 1 ? "" : "es"} touched. Monad charges 10,100 gas for the first access to an account against 2,600 on Ethereum.`,
        },
        {
            component: "memory",
            gas: delta.memory,
            label: "Memory expansion is linear",
            detail: `Peak of ${peakWords} word${peakWords === 1 ? "" : "s"}. Monad charges w/2 where Ethereum charges 3w + w²/512.`,
        },
        {
            component: "precompiles",
            gas: delta.precompiles,
            label: "Repriced precompiles",
            detail:
                trace.precompileCalls.length === 0
                    ? "None used."
                    : `${trace.precompileCalls.map((call) => call.name).join(", ")}. Monad charges a 2x to 5x multiple for these.`,
        },
    ];

    return explanations
        .filter((item) => item.gas !== 0)
        .sort((a, b) => Math.abs(b.gas) - Math.abs(a.gas));
}
