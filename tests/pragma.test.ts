/**
 * Version selection, which decides whether a contract compiles at all.
 *
 * Solidity's caret is the trap: `^0.8.1` does not allow 0.9.0, because below
 * 1.0.0 the caret pins the minor. Getting that wrong picks a compiler that
 * rejects the source, and the error it produces looks like a bug in the tool.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    chooseVersion,
    parsePragmas,
    satisfiesAll,
    satisfiesRange,
} from "../lib/solc/pragma.ts";

const RELEASES = [
    "0.4.26", "0.5.16", "0.5.17", "0.6.12", "0.7.0", "0.7.5", "0.7.6",
    "0.8.0", "0.8.19", "0.8.24", "0.8.28", "0.8.31", "0.8.36",
];
const BUNDLED = "0.8.31";

test("an exact pragma pins exactly", () => {
    const { ranges, text } = parsePragmas("pragma solidity =0.7.6;");
    assert.equal(text, "=0.7.6");
    assert.equal(ranges.length, 1);
    assert.ok(satisfiesRange("0.7.6", ranges[0]));
    assert.ok(!satisfiesRange("0.7.5", ranges[0]));
    assert.ok(!satisfiesRange("0.8.0", ranges[0]));
});

test("the caret does not cross a minor version below 1.0.0", () => {
    const { ranges } = parsePragmas("pragma solidity ^0.8.1;");
    assert.ok(satisfiesRange("0.8.1", ranges[0]));
    assert.ok(satisfiesRange("0.8.31", ranges[0]));
    assert.ok(!satisfiesRange("0.8.0", ranges[0]), "below the floor");
    assert.ok(!satisfiesRange("0.9.0", ranges[0]), "the caret must not widen the minor");
    assert.ok(!satisfiesRange("1.0.0", ranges[0]));
});

test("a compound range is satisfied only when every part is", () => {
    const { ranges } = parsePragmas("pragma solidity >=0.6.0 <0.8.0;");
    assert.equal(ranges.length, 2);
    assert.ok(satisfiesAll("0.7.6", ranges));
    assert.ok(satisfiesAll("0.6.0", ranges));
    assert.ok(!satisfiesAll("0.5.17", ranges));
    assert.ok(!satisfiesAll("0.8.0", ranges), "the upper bound is exclusive");
});

test("every pragma in a flattened file has to be satisfied at once", () => {
    // Flattening Uniswap V3 produces one pragma per original file.
    const source = `
        pragma solidity =0.7.6;
        contract A {}
        pragma solidity >=0.5.0;
        contract B {}
        pragma solidity >=0.4.0 <0.8.0;
        contract C {}
    `;
    const { ranges } = parsePragmas(source);
    assert.equal(ranges.length, 4);
    assert.ok(satisfiesAll("0.7.6", ranges), "0.7.6 is the only version all three allow");
    assert.ok(!satisfiesAll("0.8.31", ranges));
});

test("the bundled compiler is preferred when it satisfies the pragma", () => {
    const choice = chooseVersion("pragma solidity ^0.8.24;", RELEASES, BUNDLED);
    assert.equal(choice.version, BUNDLED, "no download when the bundled one will do");
    assert.match(choice.reason, /bundled/);
});

test("Uniswap V3's pragma resolves to 0.7.6 rather than failing", () => {
    const choice = chooseVersion("pragma solidity =0.7.6;", RELEASES, BUNDLED);
    assert.equal(choice.version, "0.7.6");
    assert.match(choice.reason, /fetched/);
});

test("an open range takes the newest satisfying release, not the oldest", () => {
    const choice = chooseVersion("pragma solidity >=0.6.0 <0.7.0;", RELEASES, BUNDLED);
    assert.equal(choice.version, "0.6.12");
});

test("source with no pragma falls back to the bundled compiler", () => {
    const choice = chooseVersion("contract A {}", RELEASES, BUNDLED);
    assert.equal(choice.version, BUNDLED);
    assert.equal(choice.pragma, null);
});

test("an unsatisfiable pragma is reported rather than guessed at", () => {
    const choice = chooseVersion("pragma solidity >=9.0.0;", RELEASES, BUNDLED);
    assert.equal(choice.version, null);
    assert.match(choice.reason, /No released compiler/);
});

test("a pragma without a patch component means the whole minor", () => {
    const { ranges } = parsePragmas("pragma solidity 0.8;");
    assert.ok(satisfiesRange("0.8.0", ranges[0]));
    assert.ok(satisfiesRange("0.8.31", ranges[0]));
    assert.ok(!satisfiesRange("0.7.6", ranges[0]));
});
