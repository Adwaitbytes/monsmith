/**
 * Turning what someone types into ABI arguments.
 *
 * The rule underneath every case here: quotes are notation, not content. A
 * uint256 large enough to matter cannot be written unquoted, because 1e17 is
 * already past 2^53 and a JSON number would round it. So the form has to accept
 * `["100000000000000000"]` and hand the encoder an exact bigint. The first
 * version split on commas and stripped brackets but never the quotes, and
 * rejected the only precision-safe way to write the value.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { coerceArgument } from "../lib/contractInteraction.ts";

test("a quoted big integer keeps every digit", () => {
    const args = coerceArgument('["100000000000000000", "200000000000000000"]', "uint256[]");

    assert.deepEqual(args, [100000000000000000n, 200000000000000000n]);
    // The reason quoting is required at all. Compared as strings, because a
    // JS number literal of this size is rounded on the way in too, which would
    // make the two sides of a numeric comparison agree on the wrong value.
    assert.equal(String(Number("100000000000000001")), "100000000000000000");
    assert.equal((args as bigint[])[0].toString(), "100000000000000000");
});

test("unquoted numbers still work", () => {
    assert.deepEqual(coerceArgument("[1, 2, 3]", "uint256[]"), [1n, 2n, 3n]);
});

test("a single quoted value outside a list is accepted too", () => {
    assert.equal(coerceArgument('"100000000000000000"', "uint256"), 100000000000000000n);
    assert.equal(
        coerceArgument('"0x4b52e6D398751c5A218070403008F4879c424578"', "address"),
        "0x4b52e6D398751c5A218070403008F4879c424578",
    );
});

test("quoted addresses in a list", () => {
    const value = '["0x4b52e6D398751c5A218070403008F4879c424578", "0xdB1C8df161a280C93D5997cD5437edFC79811Cc8"]';
    assert.deepEqual(coerceArgument(value, "address[]"), [
        "0x4b52e6D398751c5A218070403008F4879c424578",
        "0xdB1C8df161a280C93D5997cD5437edFC79811Cc8",
    ]);
});

test("a comma inside a string does not split the list", () => {
    assert.deepEqual(coerceArgument('["a,b", "c"]', "string[]"), ["a,b", "c"]);
});

test("nested lists split at the right level", () => {
    assert.deepEqual(coerceArgument("[[1, 2], [3]]", "uint256[][]"), [[1n, 2n], [3n]]);
});

test("an empty list is a list, not a list holding nothing", () => {
    assert.deepEqual(coerceArgument("[]", "uint256[]"), []);
    assert.deepEqual(coerceArgument("  ", "uint256[]"), []);
});

test("bools survive both spellings", () => {
    assert.deepEqual(coerceArgument('[true, "false"]', "bool[]"), [true, false]);
});

test("a fixed-size array is checked against its declared length", () => {
    assert.deepEqual(coerceArgument("[1, 2]", "uint256[2]"), [1n, 2n]);
    assert.throws(() => coerceArgument("[1, 2, 3]", "uint256[2]"), /exactly 2/);
});

test("an unbalanced bracket is reported rather than half-parsed", () => {
    assert.throws(() => coerceArgument("[1, 2", "uint256[]"), /\[.*\]|bracket/i);
});

test("a missing element is an error, not a silently shorter list", () => {
    // Dropping it would deploy a contract with fewer milestones than intended.
    assert.throws(() => coerceArgument("[1, , 2]", "uint256[]"), /empty/i);
});

test("a value that is not a number is still refused", () => {
    assert.throws(() => coerceArgument('["12x"]', "uint256[]"), /whole number/);
    assert.throws(() => coerceArgument("[1.5]", "uint256[]"), /whole number/);
});

test("one pair of quotes comes off, so a quoted string is still expressible", () => {
    assert.equal(coerceArgument('"hello"', "string"), "hello");
    assert.equal(coerceArgument('""hello""', "string"), '"hello"');
});
