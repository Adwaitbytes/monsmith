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

import { coerceArgument, describeType, placeholderFor } from "../lib/contractInteraction.ts";

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

/**
 * The rest of what Solidity lets a constructor take.
 *
 * Everything below deploys from Remix, so a contract using it has to deploy
 * here too. A struct argument had no representation at all: the type arrived as
 * the bare string "tuple", which carries none of the field types, and the value
 * fell through unconverted to be rejected inside viem.
 */

const CONFIG = [
    { name: "owner", type: "address" },
    { name: "cap", type: "uint256" },
    { name: "live", type: "bool" },
];

test("a struct becomes an object keyed by its field names", () => {
    const value = '["0x4b52e6D398751c5A218070403008F4879c424578", "1000000000000000000", true]';
    assert.deepEqual(coerceArgument(value, "tuple", CONFIG), {
        owner: "0x4b52e6D398751c5A218070403008F4879c424578",
        cap: 1000000000000000000n,
        live: true,
    });
});

test("a struct also reads in Solidity's own parenthesised form", () => {
    const value = '("0x4b52e6D398751c5A218070403008F4879c424578", 1, false)';
    assert.deepEqual(coerceArgument(value, "tuple", CONFIG), {
        owner: "0x4b52e6D398751c5A218070403008F4879c424578",
        cap: 1n,
        live: false,
    });
});

test("a struct with the wrong number of fields is refused", () => {
    assert.throws(() => coerceArgument("[1, 2]", "tuple", CONFIG), /3 field/);
});

test("an array of structs", () => {
    const pair = [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }];
    const value = '[["0x4b52e6D398751c5A218070403008F4879c424578", "1"], ["0xdB1C8df161a280C93D5997cD5437edFC79811Cc8", "2"]]';

    assert.deepEqual(coerceArgument(value, "tuple[]", pair), [
        { to: "0x4b52e6D398751c5A218070403008F4879c424578", amount: 1n },
        { to: "0xdB1C8df161a280C93D5997cD5437edFC79811Cc8", amount: 2n },
    ]);
});

test("an unnamed struct stays positional, because there are no keys to use", () => {
    const unnamed = [{ name: "", type: "uint256" }, { name: "", type: "uint256" }];
    assert.deepEqual(coerceArgument("[1, 2]", "tuple", unnamed), [1n, 2n]);
});

test("a negative value for an unsigned type is caught here, not inside viem", () => {
    assert.throws(() => coerceArgument("-1", "uint256"), /cannot be negative/i);
    assert.equal(coerceArgument("-1", "int256"), -1n);
});

test("a value too large for its width is caught before encoding", () => {
    assert.equal(coerceArgument("255", "uint8"), 255n);
    assert.throws(() => coerceArgument("256", "uint8"), /uint8/);
    assert.equal(coerceArgument("127", "int8"), 127n);
    assert.throws(() => coerceArgument("128", "int8"), /int8/);
    assert.equal(coerceArgument("-128", "int8"), -128n);
});

test("a fixed-width bytes value is checked against its width", () => {
    assert.equal(coerceArgument("0x12345678", "bytes4"), "0x12345678");
    assert.throws(() => coerceArgument("0x1234", "bytes4"), /4 bytes/);
    // Dynamic bytes has no width to check, and an odd digit count is not a byte.
    assert.equal(coerceArgument("0x1234", "bytes"), "0x1234");
    assert.throws(() => coerceArgument("0x123", "bytes"), /pairs|even/i);
});

test("hex is accepted for an integer, as every explorer writes it", () => {
    assert.equal(coerceArgument("0xff", "uint256"), 255n);
});

test("underscores in a long number are ignored, as Solidity itself allows", () => {
    assert.equal(coerceArgument("1_000_000", "uint256"), 1000000n);
});

/**
 * What the form shows before anything is typed.
 *
 * The ABI calls every struct "tuple", which tells the reader nothing about what
 * to put in the box. A list is the other thing people reliably get wrong, since
 * the bare type `uint256[]` does not hint that the values want quoting.
 */

test("a struct's label names its fields instead of saying tuple", () => {
    assert.equal(describeType("tuple", CONFIG), "(address owner, uint256 cap, bool live)");
    assert.equal(describeType("tuple[]", CONFIG), "(address owner, uint256 cap, bool live)[]");
    assert.equal(describeType("uint256", undefined), "uint256");
});

test("a nested struct's label unfolds all the way down", () => {
    const nested = [
        { name: "id", type: "uint256" },
        { name: "cfg", type: "tuple", components: CONFIG },
    ];
    assert.equal(
        describeType("tuple", nested),
        "(uint256 id, (address owner, uint256 cap, bool live) cfg)",
    );
});

test("the placeholder shows the shape the field wants", () => {
    assert.equal(placeholderFor("tuple", CONFIG), "[0x…, 0, true]");
    assert.equal(placeholderFor("tuple[]", CONFIG), "[[0x…, 0, true]]");
    assert.match(placeholderFor("uint256[]"), /^\["1000000000000000000"/);
});

test("every placeholder is something the parser would actually accept", () => {
    // A placeholder that does not parse teaches the wrong format.
    assert.deepEqual(coerceArgument(placeholderFor("uint256[]"), "uint256[]"), [
        1000000000000000000n,
        2000000000000000000n,
    ]);
    assert.deepEqual(coerceArgument(placeholderFor("bool[]"), "bool[]"), [true, false]);
    assert.equal(coerceArgument(placeholderFor("uint256"), "uint256"), 0n);
    assert.equal(coerceArgument(placeholderFor("bool"), "bool"), true);
});
