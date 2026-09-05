/**
 * Executes a compiled contract in a real EVM and records the things that Monad
 * and Ethereum price differently.
 *
 * The point of tracing rather than estimating: solc's `gasEstimates` are
 * control-flow upper bounds and report "infinite" whenever a loop's trip count
 * is not statically known, which is too coarse to subtract one chain's cost
 * model from another's. Running the code gives an exact opcode sequence, and an
 * exact Ethereum gas figure to anchor the comparison to.
 *
 * The EVM is configured with the contract size limits switched off on purpose.
 * A contract too large for EIP-170 is exactly the case a Monad comparison
 * exists to talk about, so it has to be traceable; the per-chain size limits are
 * then applied as findings rather than as execution failures.
 */

import { createEVM, type EVM } from "@ethereumjs/evm";
import {
    bigIntToBytes,
    bytesToHex,
    createAddressFromString,
    hexToBytes,
    setLengthLeft,
    type Address,
} from "@ethereumjs/util";

import { PRECOMPILE_NAMES, type AccountAccess, type StorageAccess } from "./schedules";

/** Opcodes charged the cold/warm account access cost. */
const ACCOUNT_ACCESS_OPCODES: ReadonlySet<string> = new Set([
    "BALANCE",
    "EXTCODESIZE",
    "EXTCODECOPY",
    "EXTCODEHASH",
    "CALL",
    "CALLCODE",
    "DELEGATECALL",
    "STATICCALL",
    "SELFDESTRUCT",
]);

/** Where in the stack each of those opcodes keeps its target address. */
const ADDRESS_STACK_OFFSET: ReadonlyMap<string, number> = new Map([
    ["BALANCE", 1],
    ["EXTCODESIZE", 1],
    ["EXTCODECOPY", 1],
    ["EXTCODEHASH", 1],
    ["SELFDESTRUCT", 1],
    ["CALL", 2],
    ["CALLCODE", 2],
    ["DELEGATECALL", 2],
    ["STATICCALL", 2],
]);

/** Stack position of `argsOffset` for each call opcode, counted from the top. */
const ARGS_OFFSET_STACK_OFFSET: ReadonlyMap<string, number> = new Map([
    ["CALL", 4],
    ["CALLCODE", 4],
    ["DELEGATECALL", 3],
    ["STATICCALL", 3],
]);

export interface PrecompileCall {
    address: number;
    name: string;
    /** What this call costs on Ethereum, which the Monad multiplier applies to. */
    ethereumGas: number;
}

export type TraceStatus = "ok" | "reverted" | "error";

export interface ExecutionTrace {
    status: TraceStatus;
    /** Present when the call reverted with a decodable reason string. */
    revertReason: string | null;
    /**
     * Execution gas as charged by a real Ethereum EVM. Exact, and the anchor the
     * Monad figure is derived from.
     */
    ethereumExecutionGas: number;
    /** Intrinsic cost of the transaction that carries this call. */
    intrinsicGas: number;
    /** Ethereum storage refund. Monad's model has no equivalent, so it is reported apart. */
    gasRefund: number;

    storageAccesses: StorageAccess[];
    accountAccesses: AccountAccess[];
    precompileCalls: PrecompileCall[];
    /** Memory high-water mark, in 32-byte words, for each call frame. */
    frameMemoryWords: number[];

    /**
     * Gas the EVM actually charged for SLOAD and SSTORE, summed. This is what
     * the Ethereum side of a comparison uses, so that only the Monad side is
     * modelled. Null when a frame ended before every charge could be observed,
     * in which case the repricer falls back to the model.
     */
    observedStorageGas: number | null;

    opcodeCounts: Record<string, number>;
    steps: number;
}

export interface DeploymentTrace extends ExecutionTrace {
    /** Address the contract landed at, when deployment succeeded. */
    address: string | null;
    /** Runtime bytecode length, which EIP-170 limits. */
    runtimeCodeSize: number;
    /** Init code length, which EIP-3860 limits. */
    initCodeSize: number;
}

/** Caller used for every traced call, funded generously so value transfers work. */
const CALLER = createAddressFromString("0x" + "a1".repeat(20));
const CALLER_BALANCE = 10n ** 24n;

/** Gas ceiling for tracing. Above Monad's 30M per-transaction limit on purpose,
 *  so that exceeding it is reported as a finding rather than truncating a trace. */
const TRACE_GAS_LIMIT = 200_000_000n;

interface Collector {
    storageAccesses: StorageAccess[];
    accountAccesses: AccountAccess[];
    precompileCalls: PrecompileCall[];
    frameMemoryWords: number[];
    opcodeCounts: Record<string, number>;
    steps: number;
    /** Running total of observed SLOAD/SSTORE charges. */
    observedStorageGas: number;
    /** Set when a storage charge could not be observed, invalidating the total. */
    storageObservationIncomplete: boolean;
    /** The storage op awaiting the next step, which reveals what it cost. */
    pendingStorage: { gasLeft: bigint; depth: number } | null;
}

function newCollector(): Collector {
    return {
        storageAccesses: [],
        accountAccesses: [],
        precompileCalls: [],
        frameMemoryWords: [],
        opcodeCounts: {},
        steps: 0,
        observedStorageGas: 0,
        storageObservationIncomplete: false,
        pendingStorage: null,
    };
}

function slotKey(slot: bigint): Uint8Array {
    return setLengthLeft(bigIntToBytes(slot), 32);
}

function isZeroBytes(value: Uint8Array): boolean {
    for (const byte of value) if (byte !== 0) return false;
    return true;
}

function toAddressHex(word: bigint): string {
    return bytesToHex(setLengthLeft(bigIntToBytes(word & (2n ** 160n - 1n)), 20));
}

/** Ethereum cost of a precompile, which the Monad multiplier is applied to. */
function precompileEthereumGas(
    address: number,
    inputLength: number,
    inputHead: Uint8Array,
): number {
    switch (address) {
        case 0x01:
            return 3_000;
        case 0x06:
            return 150;
        case 0x07:
            return 6_000;
        case 0x08: {
            const points = Math.floor(inputLength / 192);
            return 45_000 + 34_000 * points;
        }
        case 0x09: {
            // blake2f is priced per round, a big-endian uint32 at the front of the input.
            if (inputHead.length < 4) return 0;
            return (
                (inputHead[0] << 24) | (inputHead[1] << 16) | (inputHead[2] << 8) | inputHead[3]
            ) >>> 0;
        }
        case 0x0a:
            return 50_000;
        default:
            return 0;
    }
}

/**
 * Tracks the memory high-water mark of each call frame.
 *
 * Expansion cost telescopes to the formula applied to a frame's peak, so the
 * peak is all a repricer needs. `memoryWordCount` is read before the step runs,
 * which means the growth caused by a frame's final opcode is not observed; that
 * makes the memory component a lower bound, and it is only ever a few gas.
 */
class FrameMemoryTracker {
    private readonly peaks: number[] = [];
    private depth = -1;
    readonly completed: number[] = [];

    observe(depth: number, words: number): void {
        while (this.depth > depth) {
            this.completed.push(this.peaks[this.depth]);
            this.depth -= 1;
        }
        while (this.depth < depth) {
            this.depth += 1;
            this.peaks[this.depth] = 0;
        }
        if (words > this.peaks[depth]) this.peaks[depth] = words;
    }

    finish(): void {
        while (this.depth >= 0) {
            this.completed.push(this.peaks[this.depth]);
            this.depth -= 1;
        }
    }
}

/** Creates an EVM with the size limits lifted, so oversized contracts can be traced. */
export async function createTracingEvm(): Promise<EVM> {
    return createEVM({
        allowUnlimitedContractSize: true,
        allowUnlimitedInitCodeSize: true,
    });
}

/**
 * Puts the EVM back at a transaction boundary.
 *
 * `runCall` on its own does not reset the journal, so warm addresses, warm
 * storage slots and the original-value cache all survive into the next call.
 * Without this, a slot the constructor wrote is still warm when a function is
 * traced, and EIP-2200 sees it as already dirty: an SLOAD that should cost
 * 2,100 is charged 100, and an SSTORE that should cost 2,900 is charged 100.
 * Every function would then be measured as though it ran in the same
 * transaction as the deployment, which is not how anyone calls a contract.
 *
 * This is what `VM.runTx` does between transactions, and callers of `runCall`
 * have to do it themselves.
 */
function beginTransaction(evm: EVM): void {
    const journal = evm.journal as unknown as { cleanJournal?: () => void };
    journal.cleanJournal?.();

    const stateManager = evm.stateManager as unknown as {
        originalStorageCache?: { clear?: () => void };
    };
    stateManager.originalStorageCache?.clear?.();
}

function attachCollector(evm: EVM, collector: Collector, memory: FrameMemoryTracker) {
    const handler = async (data: unknown, resolve?: (value?: unknown) => void) => {
        const step = data as {
            opcode: { name: string };
            stack: bigint[];
            depth: number;
            gasLeft: bigint;
            memoryWordCount: number | bigint;
            memory: Uint8Array;
            address: Address;
        };

        collector.steps += 1;
        const name = step.opcode.name;
        collector.opcodeCounts[name] = (collector.opcodeCounts[name] ?? 0) + 1;
        memory.observe(step.depth, Number(step.memoryWordCount));

        // The cost of the previous storage op is the drop in remaining gas, but
        // gas is tracked per frame, so a step at a different depth tells us
        // nothing about it.
        const pending = collector.pendingStorage;
        if (pending !== null) {
            if (pending.depth === step.depth) {
                collector.observedStorageGas += Number(pending.gasLeft - step.gasLeft);
            } else {
                collector.storageObservationIncomplete = true;
            }
            collector.pendingStorage = null;
        }
        if (name === "SLOAD" || name === "SSTORE") {
            collector.pendingStorage = { gasLeft: step.gasLeft, depth: step.depth };
        }

        const stack = step.stack;
        const account = step.address.toString().toLowerCase();

        try {
            if (name === "SLOAD") {
                const slot = stack[stack.length - 1];
                if (slot !== undefined) {
                    collector.storageAccesses.push({
                        account,
                        slot,
                        kind: "load",
                        createsSlot: false,
                        clearsSlot: false,
                        changesValue: false,
                    });
                }
            } else if (name === "SSTORE") {
                const slot = stack[stack.length - 1];
                const newValue = stack[stack.length - 2];
                if (slot !== undefined && newValue !== undefined) {
                    const current = await evm.stateManager.getStorage(step.address, slotKey(slot));
                    const currentZero = isZeroBytes(current);
                    const newZero = newValue === 0n;
                    const currentValue = current.length === 0 ? 0n : BigInt(bytesToHex(current));
                    collector.storageAccesses.push({
                        account,
                        slot,
                        kind: "store",
                        createsSlot: currentZero && !newZero,
                        clearsSlot: !currentZero && newZero,
                        changesValue: currentValue !== newValue,
                    });
                }
            } else if (ACCOUNT_ACCESS_OPCODES.has(name)) {
                const offset = ADDRESS_STACK_OFFSET.get(name) ?? 1;
                const word = stack[stack.length - offset];
                if (word !== undefined) {
                    const target = toAddressHex(word);
                    collector.accountAccesses.push({ address: target, opcode: name });

                    const numeric = Number(word & 0xffn);
                    const isPrecompile = word > 0n && word <= 0x0an;
                    const argsOffsetIndex = ARGS_OFFSET_STACK_OFFSET.get(name);
                    if (isPrecompile && argsOffsetIndex !== undefined) {
                        const argsOffset = stack[stack.length - argsOffsetIndex];
                        const argsLength = stack[stack.length - argsOffsetIndex - 1];
                        const length = argsLength === undefined ? 0 : Number(argsLength);
                        const start = argsOffset === undefined ? 0 : Number(argsOffset);
                        const head = step.memory.subarray(start, start + 4);
                        const ethereumGas = precompileEthereumGas(numeric, length, head);
                        if (ethereumGas > 0) {
                            collector.precompileCalls.push({
                                address: numeric,
                                name: PRECOMPILE_NAMES[numeric] ?? `0x${numeric.toString(16)}`,
                                ethereumGas,
                            });
                        }
                    }
                }
            }
        } catch {
            // A stack read that does not line up means the frame is about to fail
            // anyway. Dropping the observation is better than aborting the trace.
        }

        if (typeof resolve === "function") resolve();
    };

    evm.events.on("step", handler);
    return () => evm.events.removeListener("step", handler);
}

function decodeRevertReason(returnValue: Uint8Array): string | null {
    // Error(string) selector, then an ABI-encoded string.
    if (returnValue.length < 4 + 32 + 32) return null;
    const selector = bytesToHex(returnValue.subarray(0, 4));
    if (selector !== "0x08c379a0") return null;
    try {
        const lengthBytes = returnValue.subarray(4 + 32, 4 + 64);
        const length = Number(BigInt(bytesToHex(lengthBytes)));
        if (length === 0 || length > returnValue.length) return null;
        const body = returnValue.subarray(4 + 64, 4 + 64 + length);
        return new TextDecoder().decode(body);
    } catch {
        return null;
    }
}

function buildTrace(
    collector: Collector,
    memory: FrameMemoryTracker,
    executionGas: bigint,
    refund: bigint,
    intrinsic: number,
    error: { error: string } | undefined,
    returnValue: Uint8Array,
): ExecutionTrace {
    memory.finish();
    // A storage op still pending when execution ended was never priced.
    const incomplete = collector.storageObservationIncomplete || collector.pendingStorage !== null;
    const reverted = error !== undefined;
    return {
        status: reverted ? (error.error === "revert" ? "reverted" : "error") : "ok",
        revertReason: reverted ? decodeRevertReason(returnValue) : null,
        ethereumExecutionGas: Number(executionGas),
        intrinsicGas: intrinsic,
        gasRefund: Number(refund),
        storageAccesses: collector.storageAccesses,
        accountAccesses: collector.accountAccesses,
        precompileCalls: collector.precompileCalls,
        frameMemoryWords: memory.completed,
        observedStorageGas: incomplete ? null : collector.observedStorageGas,
        opcodeCounts: collector.opcodeCounts,
        steps: collector.steps,
    };
}

/** Deploys `initCode`, tracing the constructor. */
export async function traceDeployment(
    evm: EVM,
    initCode: Uint8Array,
    intrinsic: number,
): Promise<DeploymentTrace> {
    await evm.stateManager.putAccount(CALLER, undefined);
    const account = await evm.stateManager.getAccount(CALLER);
    if (account !== undefined) {
        account.balance = CALLER_BALANCE;
        await evm.stateManager.putAccount(CALLER, account);
    }

    const collector = newCollector();
    const memory = new FrameMemoryTracker();
    const detach = attachCollector(evm, collector, memory);
    beginTransaction(evm);

    try {
        const result = await evm.runCall({
            caller: CALLER,
            origin: CALLER,
            data: initCode,
            gasLimit: TRACE_GAS_LIMIT,
        });
        const exec = result.execResult;
        const base = buildTrace(
            collector,
            memory,
            exec.executionGasUsed,
            exec.gasRefund ?? 0n,
            intrinsic,
            exec.exceptionError as { error: string } | undefined,
            exec.returnValue,
        );
        const address = result.createdAddress ?? null;
        const runtimeCode =
            address === null ? new Uint8Array(0) : await evm.stateManager.getCode(address);
        return {
            ...base,
            address: address === null ? null : address.toString(),
            runtimeCodeSize: runtimeCode.length,
            initCodeSize: initCode.length,
        };
    } finally {
        detach();
    }
}

/**
 * Calls a deployed contract, tracing the call.
 *
 * State is checkpointed and rolled back, so every function is measured against
 * the same post-deployment state rather than against whatever the previously
 * measured function left behind.
 */
export async function traceCall(
    evm: EVM,
    to: string,
    calldata: Uint8Array,
    intrinsic: number,
    value = 0n,
): Promise<ExecutionTrace> {
    const collector = newCollector();
    const memory = new FrameMemoryTracker();
    const detach = attachCollector(evm, collector, memory);
    await evm.stateManager.checkpoint();
    beginTransaction(evm);

    try {
        const result = await evm.runCall({
            caller: CALLER,
            origin: CALLER,
            to: createAddressFromString(to),
            data: calldata,
            value,
            gasLimit: TRACE_GAS_LIMIT,
        });
        const exec = result.execResult;
        return buildTrace(
            collector,
            memory,
            exec.executionGasUsed,
            exec.gasRefund ?? 0n,
            intrinsic,
            exec.exceptionError as { error: string } | undefined,
            exec.returnValue,
        );
    } finally {
        detach();
        await evm.stateManager.revert();
    }
}

/** Convenience for callers holding hex strings rather than byte arrays. */
export function toBytes(hex: string): Uint8Array {
    return hexToBytes(hex.startsWith("0x") ? (hex as `0x${string}`) : (`0x${hex}` as `0x${string}`));
}

export { CALLER as TRACE_CALLER };
