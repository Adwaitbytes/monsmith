/**
 * Bytecode reproduction, which decides whether a report may claim to describe
 * the deployed contract.
 *
 * The two legitimate differences are the whole subject. Immutables are blank in
 * compiler output and filled at construction. The trailing CBOR metadata is a
 * hash of the source that moves if a comment moved. Neither changes what
 * executes. Anything else does, and must be reported as a mismatch, because the
 * cost of a false positive here is a page of confident numbers about a contract
 * that is not the one at that address.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { compareRuntimeBytecode, isReproduced } from "../lib/chainfit/verify.ts";

/** Builds runtime code with a valid trailing CBOR metadata section. */
function withMetadata(body: string, metadataHex: string): string {
    const lengthBytes = metadataHex.length / 2;
    return body + metadataHex + lengthBytes.toString(16).padStart(4, "0");
}

test("identical bytecode is an exact match", () => {
    const result = compareRuntimeBytecode("0x6080604052", "0x6080604052");
    assert.equal(result.status, "exact");
    assert.ok(isReproduced(result));
});

test("differing lengths are a mismatch and are not explained away", () => {
    const result = compareRuntimeBytecode("0x6080", "0x60806040");
    assert.equal(result.status, "mismatch");
    assert.ok(!isReproduced(result));
    assert.match(result.detail, /Different lengths/);
});

test("immutable placeholders are masked using the compiler's own offsets", () => {
    // 8 bytes; bytes 2..5 are an immutable the chain filled in.
    const produced = "0x1122000000006677";
    const onchain = "0x1122aabbccdd6677";
    const refs = { "42": [{ start: 2, length: 4 }] };

    const result = compareRuntimeBytecode(produced, onchain, refs);
    assert.equal(result.status, "exact-modulo-immutables");
    assert.equal(result.immutableBytesMasked, 4);
    assert.ok(isReproduced(result));
});

test("a difference outside the immutable range is still a mismatch", () => {
    // Byte 0 differs, which no immutable reference covers.
    const produced = "0x9922000000006677";
    const onchain = "0x1122aabbccdd6677";
    const refs = { "42": [{ start: 2, length: 4 }] };

    const result = compareRuntimeBytecode(produced, onchain, refs);
    assert.equal(result.status, "mismatch");
    assert.ok(!isReproduced(result));
});

test("a difference confined to the trailing metadata is reported as such", () => {
    const body = "60806040523480156100";
    const a = withMetadata(body, "a2646970667358221111");
    const b = withMetadata(body, "a2646970667358222222");

    const result = compareRuntimeBytecode(`0x${a}`, `0x${b}`);
    assert.equal(result.status, "exact-modulo-metadata");
    assert.ok(isReproduced(result), "metadata is never executed, so it cannot change gas");
    assert.match(result.detail, /not executed/);
});

test("a difference in executed code is a mismatch even when metadata also differs", () => {
    const a = withMetadata("60806040523480156100", "a2646970667358221111");
    const b = withMetadata("60806040523480156199", "a2646970667358222222");

    const result = compareRuntimeBytecode(`0x${a}`, `0x${b}`);
    assert.equal(result.status, "mismatch");
    assert.ok(!isReproduced(result));
});

test("an absurd metadata length is not trusted as a metadata section", () => {
    // Final two bytes claim 0xffff bytes of metadata, far longer than the code.
    const a = "6080604052ffff";
    const b = "6080604099ffff";
    const result = compareRuntimeBytecode(`0x${a}`, `0x${b}`);
    assert.equal(result.status, "mismatch");
});

test("an empty side is reported as unavailable rather than as a match", () => {
    const result = compareRuntimeBytecode("0x", "0x6080");
    assert.equal(result.status, "unavailable");
    assert.ok(!isReproduced(result));
});
