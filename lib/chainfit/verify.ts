import "server-only";

/**
 * Proving that the thing we measured is the thing that is deployed.
 *
 * Every gas number this tool produces describes a compilation. Whether that
 * compilation is the one running on chain is a separate question, and normally
 * an unanswered one: compile the same source with a different compiler version,
 * a different optimizer setting, or a different evmVersion and you get
 * different bytecode and different gas. A report that does not check has quietly
 * measured a contract that does not exist.
 *
 * So when a verified build is available, we compile with the exact recorded
 * settings and compare the result against the code on chain. If they match, the
 * numbers are provably about the deployed contract rather than about a
 * plausible reconstruction of it.
 *
 * Immutables are the one legitimate difference. `immutable` variables are
 * written into the runtime code at construction, so the compiler's output has
 * zeroed placeholders where the chain has real values. solc reports exactly
 * where those are, so both sides are masked at those offsets before comparing.
 * Masking anything else would be moving the goalposts; this is the compiler
 * telling us which bytes it deliberately left blank.
 *
 * The trailing CBOR metadata is the second legitimate difference. Solidity
 * appends a hash of the source and settings to the end of the runtime code
 * unless asked not to, and that hash moves if a comment or a file path differs
 * from the original build even when every executed byte is identical. It sits
 * past the last instruction, so it is never executed and costs no gas. This is
 * what Sourcify calls a partial match, and it is reported as its own outcome
 * rather than folded into either success or failure.
 */

export type ReproductionStatus =
    | "exact"
    | "exact-modulo-immutables"
    | "exact-modulo-metadata"
    | "mismatch"
    | "unavailable";

export interface ImmutableReference {
    start: number;
    length: number;
}

export interface Reproduction {
    status: ReproductionStatus;
    producedBytes: number;
    onchainBytes: number;
    /** Bytes excluded from the comparison because the compiler marked them immutable. */
    immutableBytesMasked: number;
    /** One line a reader can act on. */
    detail: string;
}

function strip(hex: string): string {
    return hex.replace(/^0x/, "").toLowerCase();
}

/**
 * Byte offset where the appended CBOR metadata begins, or null when there is
 * none. The final two bytes hold its length, big-endian, excluding themselves.
 */
function metadataStart(hex: string): number | null {
    if (hex.length < 8) return null;
    const declared = parseInt(hex.slice(-4), 16);
    if (Number.isNaN(declared) || declared <= 0) return null;

    const totalBytes = hex.length / 2;
    const start = totalBytes - declared - 2;
    // A length that would run off the front is not a metadata section.
    if (start <= 0 || declared > 256) return null;
    return start;
}

/**
 * Compares compiled runtime bytecode against what is deployed.
 *
 * `immutableReferences` comes from solc's own output for the compiled contract,
 * keyed by AST id, each entry listing byte offsets into the runtime code.
 */
export function compareRuntimeBytecode(
    produced: string,
    onchain: string,
    immutableReferences: Record<string, ImmutableReference[]> = {},
): Reproduction {
    const a = strip(produced);
    const b = strip(onchain);

    if (a.length === 0 || b.length === 0) {
        return {
            status: "unavailable",
            producedBytes: a.length / 2,
            onchainBytes: b.length / 2,
            immutableBytesMasked: 0,
            detail: "One side had no bytecode, so no comparison was possible.",
        };
    }

    if (a === b) {
        return {
            status: "exact",
            producedBytes: a.length / 2,
            onchainBytes: b.length / 2,
            immutableBytesMasked: 0,
            detail: "Recompiled bytecode is byte-for-byte the code deployed at this address.",
        };
    }

    if (a.length !== b.length) {
        return {
            status: "mismatch",
            producedBytes: a.length / 2,
            onchainBytes: b.length / 2,
            immutableBytesMasked: 0,
            detail:
                `Recompiled to ${a.length / 2} bytes against ${b.length / 2} on chain. ` +
                "Different lengths mean different settings or different source, not a placeholder difference.",
        };
    }

    const left = a.split("");
    const right = b.split("");
    let masked = 0;

    for (const references of Object.values(immutableReferences)) {
        for (const { start, length } of references) {
            for (let i = start * 2; i < (start + length) * 2 && i < left.length; i += 1) {
                left[i] = "0";
                right[i] = "0";
                masked += 1;
            }
        }
    }

    const maskedBytes = masked / 2;

    if (left.join("") === right.join("")) {
        return {
            status: "exact-modulo-immutables",
            producedBytes: a.length / 2,
            onchainBytes: b.length / 2,
            immutableBytesMasked: maskedBytes,
            detail:
                `Recompiled bytecode matches the deployed code everywhere except ${maskedBytes} bytes ` +
                "of immutable values, which are written in at construction and cannot appear in compiler output.",
        };
    }

    // Every remaining difference may still sit inside the appended metadata.
    const start = metadataStart(b);
    if (start !== null) {
        let inside = true;
        for (let i = 0; i < left.length; i += 1) {
            if (left[i] === right[i]) continue;
            if (i < start * 2) inside = false;
        }

        if (inside) {
            const metadataBytes = b.length / 2 - start;
            return {
                status: "exact-modulo-metadata",
                producedBytes: a.length / 2,
                onchainBytes: b.length / 2,
                immutableBytesMasked: maskedBytes,
                detail:
                    `Every executed byte matches the deployed code. The only difference is inside the ` +
                    `${metadataBytes} byte metadata hash appended to the end, which is not executed and ` +
                    "moves if a comment or file path differs from the original build.",
            };
        }
    }

    let differing = 0;
    for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) differing += 1;

    return {
        status: "mismatch",
        producedBytes: a.length / 2,
        onchainBytes: b.length / 2,
        immutableBytesMasked: maskedBytes,
        detail:
            `${Math.ceil(differing / 2)} bytes differ from the deployed code after masking immutables. ` +
            "The gas figures describe this source as compiled here, not necessarily the contract at this address.",
    };
}

/**
 * Whether a reproduction is good enough to call the numbers on-chain-accurate.
 *
 * A metadata-only difference counts: those bytes sit past the last instruction
 * and change neither what executes nor what it costs.
 */
export function isReproduced(reproduction: Reproduction): boolean {
    return (
        reproduction.status === "exact" ||
        reproduction.status === "exact-modulo-immutables" ||
        reproduction.status === "exact-modulo-metadata"
    );
}
