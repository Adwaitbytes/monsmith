/**
 * Failing safe when a proxy changes between a check and a call.
 *
 * A check before a call reads the proxy's implementation at one block and the
 * call executes at a later one. An upgrade in between means the caller holds an
 * answer about code that no longer runs. Two things close that gap without
 * trusting timing. Every answer about a proxy names the implementation and the
 * block it was read at, and a caller can hand that implementation back right
 * before sending: if the proxy points anywhere else, the answer is "stale" and
 * the check fails closed rather than passing on old information.
 */

export interface StaleAnswer {
    attested: false;
    stale: true;
    expectedImplementation: string;
    implementation: string;
    reason: string;
}

function sameAddress(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

/** True when the implementation a caller holds is a valid address and is not what runs now. */
export function isStale(expected: string | null, current: string): boolean {
    if (expected === null) return false;
    if (!/^0x[0-9a-fA-F]{40}$/.test(expected)) return true;
    return !sameAddress(expected, current);
}

export function staleAnswer(expected: string, current: string): StaleAnswer {
    return {
        attested: false,
        stale: true,
        expectedImplementation: expected,
        implementation: current,
        reason: 'The proxy now runs different code than the answer you hold, so that answer no longer applies. Do not call it until the new implementation is checked.',
    };
}

/** The studio's name for a chain, for the "audit the new code" link. */
export const CHAIN_KEYS: Readonly<Record<number, string>> = {
    143: 'monad-mainnet',
    10143: 'monad-testnet',
    1: 'ethereum',
    11155111: 'sepolia',
};
