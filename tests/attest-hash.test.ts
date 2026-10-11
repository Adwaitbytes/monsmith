/**
 * The hashes an onchain attestation commits to.
 *
 * The property that matters: a report hashes to the same value however its
 * keys happen to be ordered, because the database does not keep key order and
 * a hash that changed on the way back out would make every check fail.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toBytes } from "viem";

import { canonicalJson, reportHash, sourceHash } from "../lib/attest/hash.ts";
import type { RepoReport } from "../lib/report/types.ts";

test("key order does not change the canonical form", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }), canonicalJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));
    assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test("undefined fields are dropped like JSON does, and array holes become null", () => {
    assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
    assert.equal(canonicalJson([undefined, 1]), "[null,1]");
});

const report = {
    reportId: "r1",
    createdAt: "2026-10-11T00:00:00.000Z",
    origin: { kind: "workspace" },
    health: { score: 79, grade: "B", headline: "" },
    counts: { critical: 0, high: 0, medium: 3, low: 2, info: 6 },
    contracts: [],
    skipped: [],
    notes: [],
    redacted: false,
} as unknown as RepoReport;

test("a report hashes the same after a round trip through JSON with keys reordered", () => {
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(report).reverse()))) as RepoReport;
    assert.equal(reportHash(reordered), reportHash(report));
});

test("the hash covers the content: change the score and it changes", () => {
    const changed = { ...report, health: { score: 80, grade: "B", headline: "" } } as RepoReport;
    assert.notEqual(reportHash(changed), reportHash(report));
});

test("the source hash is plain keccak256 of the file, so anyone can recompute it", () => {
    assert.equal(sourceHash("contract A {}"), keccak256(toBytes("contract A {}")));
});
