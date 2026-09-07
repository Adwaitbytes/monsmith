/**
 * Synthesises call arguments from an ABI so a contract can be traced without
 * the developer having to hand-write a transaction for every function.
 *
 * Synthesised arguments buy coverage, not truth. A function guarded by a
 * balance check or an allowance will revert, and a reverting trace only shows
 * the path up to the revert. Every result therefore carries its status, and the
 * report never folds a reverted trace into a headline number. Where a real call
 * matters, the caller can pass explicit arguments instead.
 *
 * Argument sizes are varied on purpose. Monad charges the gas limit rather than
 * the gas used, so how much a function's cost moves with its input is a cost
 * question there in a way it is not anywhere else. Running each function at
 * several input sizes is what turns that into a measurement.
 */

import { encodeFunctionData, type Abi, type AbiFunction, type AbiParameter } from "viem";

/** Non-zero, so that the many contracts which reject `address(0)` do not trip. */
const SAMPLE_ADDRESS = "0x00000000000000000000000000000000000000a1" as const;

export type ArgScale = "small" | "medium" | "large";

/** Element counts and string lengths used at each scale. */
const SCALE_SIZES: Record<ArgScale, { elements: number; chars: number }> = {
    small: { elements: 0, chars: 0 },
    medium: { elements: 1, chars: 8 },
    large: { elements: 8, chars: 128 },
};

export interface SynthesisedCall {
    scale: ArgScale;
    calldata: `0x${string}`;
    args: unknown[];
}

function sampleValue(param: AbiParameter, scale: ArgScale): unknown {
    const type = param.type;
    const size = SCALE_SIZES[scale];

    const arrayMatch = type.match(/^(.*)\[(\d*)\]$/);
    if (arrayMatch !== null) {
        const elementType = arrayMatch[1];
        const fixedLength = arrayMatch[2];
        const count = fixedLength === "" ? size.elements : Number(fixedLength);
        const element = { ...param, type: elementType } as AbiParameter;
        return Array.from({ length: count }, () => sampleValue(element, scale));
    }

    if (type === "address") return SAMPLE_ADDRESS;
    if (type === "bool") return true;
    if (type === "string") return "m".repeat(size.chars);
    if (type === "bytes") return `0x${"11".repeat(size.chars)}` as `0x${string}`;

    const fixedBytes = type.match(/^bytes(\d+)$/);
    if (fixedBytes !== null) {
        const width = Number(fixedBytes[1]);
        return `0x${"11".repeat(width)}` as `0x${string}`;
    }

    if (/^u?int\d*$/.test(type)) return 1n;

    if (type.startsWith("tuple")) {
        const components = (param as { components?: readonly AbiParameter[] }).components ?? [];
        return components.map((component) => sampleValue(component, scale));
    }

    // An unrecognised type is better represented as zero than guessed at.
    return 0n;
}

/** True when the function's cost can vary with the size of its inputs. */
export function hasDynamicInputs(fn: AbiFunction): boolean {
    const dynamic = (param: AbiParameter): boolean => {
        if (param.type.endsWith("[]")) return true;
        if (param.type === "string" || param.type === "bytes") return true;
        if (param.type.startsWith("tuple")) {
            const components = (param as { components?: readonly AbiParameter[] }).components ?? [];
            return components.some(dynamic);
        }
        return false;
    };
    return fn.inputs.some(dynamic);
}

/** Canonical signature, matching the key solc uses for its gas estimates. */
export function canonicalSignature(fn: AbiFunction): string {
    const encode = (param: AbiParameter): string => {
        if (param.type.startsWith("tuple")) {
            const components = (param as { components?: readonly AbiParameter[] }).components ?? [];
            return `(${components.map(encode).join(",")})${param.type.slice("tuple".length)}`;
        }
        return param.type;
    };
    return `${fn.name}(${fn.inputs.map(encode).join(",")})`;
}

/**
 * Calldata for one function at each input scale worth trying. Functions with no
 * dynamic inputs get a single encoding, because varying the scale would produce
 * identical bytes.
 */
export function synthesiseCalls(abi: Abi, fn: AbiFunction): SynthesisedCall[] {
    const scales: ArgScale[] = hasDynamicInputs(fn) ? ["small", "medium", "large"] : ["medium"];
    const calls: SynthesisedCall[] = [];

    for (const scale of scales) {
        const args = fn.inputs.map((input) => sampleValue(input, scale));
        try {
            const calldata = encodeFunctionData({
                abi,
                functionName: fn.name,
                args,
            } as Parameters<typeof encodeFunctionData>[0]);
            calls.push({ scale, calldata, args });
        } catch {
            // An encoding we cannot produce is a function we cannot trace. Skipping
            // it leaves a gap in the report, which is better than a wrong number.
        }
    }

    return calls;
}

/** Constructor calldata appended to the deployment bytecode. */
export function synthesiseConstructorArgs(abi: Abi, scale: ArgScale = "medium"): unknown[] {
    const constructor = abi.find(
        (entry): entry is Extract<Abi[number], { type: "constructor" }> =>
            entry.type === "constructor",
    );
    if (constructor === undefined) return [];
    return constructor.inputs.map((input) => sampleValue(input, scale));
}

/**
 * Argument sets to try for a constructor, in order, until one deploys.
 *
 * One guess is not enough. A constructor that sums an array and requires
 * msg.value to equal the total reverts for any non-empty array, since a traced
 * deployment sends no value; an escrow, a vesting schedule and a payment
 * splitter are all shaped that way. Falling back to empty arrays makes that
 * class deploy, and it is worth trying because the alternative is reporting the
 * gas of a deployment that failed.
 *
 * Every set is a guess, so the caller still has to check what actually
 * succeeded rather than assume the first one did.
 */
export function constructorAttempts(abi: Abi): { label: string; args: unknown[] }[] {
    const constructor = abi.find(
        (entry): entry is Extract<Abi[number], { type: "constructor" }> =>
            entry.type === "constructor",
    );
    if (constructor === undefined || constructor.inputs.length === 0) {
        return [{ label: "no arguments", args: [] }];
    }

    const attempts = [{ label: "sample arguments", args: synthesiseConstructorArgs(abi) }];

    // Arrays emptied, everything else left alone: this is the set that gets a
    // value-checking constructor past its own require.
    if (constructor.inputs.some((input) => /\[\d*\]$/.test(input.type))) {
        attempts.push({
            label: "sample arguments with empty arrays",
            args: constructor.inputs.map((input) =>
                /\[\]$/.test(input.type) ? [] : sampleValue(input, "medium"),
            ),
        });
    }

    return attempts;
}

/** Public and external functions, which are the ones a user pays gas to call. */
export function callableFunctions(abi: Abi): AbiFunction[] {
    return abi.filter(
        (entry): entry is AbiFunction =>
            entry.type === "function" &&
            (entry.stateMutability === "nonpayable" || entry.stateMutability === "payable"),
    );
}

/** Read-only functions. Traced separately: they cost gas only inside another call. */
export function viewFunctions(abi: Abi): AbiFunction[] {
    return abi.filter(
        (entry): entry is AbiFunction =>
            entry.type === "function" &&
            (entry.stateMutability === "view" || entry.stateMutability === "pure"),
    );
}
