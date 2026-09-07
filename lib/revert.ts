/**
 * Saying why a transaction failed.
 *
 * Solidity 0.8.4 added custom errors, and they are now the normal way to fail:
 * `revert InvalidDepositAmount()` costs far less gas than a require string. The
 * cost is that the chain returns only a four-byte selector, so a wallet or an
 * RPC has nothing to print and reports "execution reverted" or a run of hex.
 *
 * The selector is decodable against the contract's own ABI, which the studio
 * has in hand, so the name and arguments of the error the contract actually
 * raised can be shown instead.
 */

import { decodeErrorResult, type Abi } from "viem";

/** `Error(string)`, the encoding of a plain `require("...")`. */
const ERROR_STRING = "0x08c379a0";
/** `Panic(uint256)`, raised by overflow, division by zero, a bad index. */
const PANIC = "0x4e487b71";

const PANIC_REASONS: Record<string, string> = {
    "0x01": "an assert() failed",
    "0x11": "arithmetic overflowed or underflowed",
    "0x12": "division or modulo by zero",
    "0x21": "a value was converted to an enum that has no such member",
    "0x22": "a storage byte array is incorrectly encoded",
    "0x31": "pop() was called on an empty array",
    "0x32": "an array index is out of bounds",
    "0x41": "too much memory was allocated, or an array is too large",
    "0x51": "an uninitialised internal function was called",
};

/**
 * Digs the revert payload out of whatever the wallet or RPC wrapped it in.
 *
 * Every layer nests the one below it in `cause`, and which layer carries the
 * data depends on the provider, so the whole chain is searched rather than one
 * agreed-on shape assumed.
 */
export function revertData(error: unknown): `0x${string}` | null {
    const seen = new Set<unknown>();
    let current: unknown = error;

    while (current !== null && typeof current === "object" && !seen.has(current)) {
        seen.add(current);
        const node = current as Record<string, unknown>;

        for (const key of ["data", "raw"]) {
            const value = node[key];
            if (typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value) && value.length >= 10) {
                return value as `0x${string}`;
            }
            // Some providers nest it one deeper, as { data: { data: "0x..." } }.
            if (value !== null && typeof value === "object") {
                const inner = (value as Record<string, unknown>).data;
                if (typeof inner === "string" && /^0x[0-9a-fA-F]{8,}$/.test(inner)) {
                    return inner as `0x${string}`;
                }
            }
        }

        current = node.cause;
    }

    return null;
}

/** Renders a decoded argument without losing precision or printing [object]. */
function show(value: unknown): string {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return `[${value.map(show).join(", ")}]`;
    return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)) ?? "";
}

/**
 * Turns revert data into the reason, using the contract's own ABI.
 *
 * Returns null when there is nothing better to say than the caller already has,
 * so a failed decode never replaces a real message with a worse one.
 */
export function decodeRevert(data: string | null, abi: Abi): string | null {
    if (data === null || data.length < 10) return null;

    const selector = data.slice(0, 10).toLowerCase();

    if (selector === ERROR_STRING) {
        try {
            const decoded = decodeErrorResult({ abi, data: data as `0x${string}` });
            return `reverted: ${String(decoded.args?.[0] ?? "")}`;
        } catch {
            return null;
        }
    }

    if (selector === PANIC) {
        try {
            const decoded = decodeErrorResult({ abi, data: data as `0x${string}` });
            const code = `0x${(decoded.args?.[0] as bigint).toString(16).padStart(2, "0")}`;
            const reason = PANIC_REASONS[code];
            return reason === undefined
                ? `reverted with panic code ${code}`
                : `reverted because ${reason} (panic ${code})`;
        } catch {
            return null;
        }
    }

    try {
        const decoded = decodeErrorResult({ abi, data: data as `0x${string}` });
        const args = (decoded.args ?? []).map(show);
        return `reverted with ${decoded.errorName}(${args.join(", ")})`;
    } catch {
        // A selector the ABI does not define, which happens when the revert came
        // from a different contract this one called into.
        return `reverted with an error not defined in this contract (selector ${selector})`;
    }
}

/** The best available explanation of a failure, or null to leave it alone. */
export function explainRevert(error: unknown, abi: Abi): string | null {
    return decodeRevert(revertData(error), abi);
}
