/**
 * The hashes an onchain attestation commits to, computed the same way on the
 * server that writes it and in any browser that checks it.
 */

import { keccak256, toBytes, type Hex } from 'viem';

import type { RepoReport } from '../report/types';

/**
 * JSON with object keys sorted, so the same report always serialises to the
 * same bytes. The report is stored as JSONB, which does not keep key order,
 * and a hash over unsorted JSON would stop matching the moment it was read
 * back.
 */
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry === undefined ? null : entry)).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
}

/** keccak256 of the report as published, unredacted. */
export function reportHash(report: RepoReport): Hex {
    return keccak256(toBytes(canonicalJson({ ...report, redacted: false })));
}

/** keccak256 of a source file, which is what an attestation is keyed by. */
export function sourceHash(source: string): Hex {
    return keccak256(toBytes(source));
}
