/**
 * The static security rules, on the code people actually paste.
 *
 * Every false positive here costs a famous contract a letter grade, so each
 * one that was found in the wild has a test: WETH9 marked high for letting
 * people withdraw their own deposit, a timestamp warning from the word
 * "known", and a tx.origin finding raised by a comment. The real bugs must
 * still be caught, which is what the last tests are for.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { __testing } from "../lib/report/build.ts";

const { analyzeSecurity } = __testing;
const titles = (source: string) => analyzeSecurity(source).issues.map((issue) => issue.title);

const WETH9 = readFileSync("public/samples/weth9/contracts/WETH9.sol", "utf8");
const DAO = readFileSync("public/samples/the-dao/contracts/TheDAO.sol", "utf8");

test("withdrawing your own deposit is not missing access control", () => {
    assert.ok(!titles(WETH9).includes("Missing Access Control"));
});

test("a word containing 'now' is not a timestamp dependency", () => {
    assert.ok(!titles(WETH9).includes("Block Timestamp Dependency"));
    assert.ok(titles("contract A { function f() public { uint t = block.timestamp; } }").includes("Block Timestamp Dependency"));
});

test("tx.origin in a comment is not a finding, in code it is", () => {
    assert.ok(!titles("contract A {\n    // never use tx.origin here\n    function f() public {}\n}").includes("Use of tx.origin for Authorization"));
    assert.ok(titles("contract A { function f() public { require(tx.origin == address(1)); } }").includes("Use of tx.origin for Authorization"));
});

test("the licence line is still read, although it is a comment", () => {
    assert.ok(!titles("// SPDX-License-Identifier: MIT\ncontract A {}").includes("Missing SPDX License Identifier"));
    assert.ok(titles("contract A {}").includes("Missing SPDX License Identifier"));
});

test("a public mint to any address with no guard is still flagged", () => {
    const open = "contract T { mapping(address => uint) b; function mint(address to, uint a) public { b[to] += a; } }";
    assert.ok(titles(open).includes("Missing Access Control"));
});

test("a guarded mint is not flagged, by modifier or by a check on the caller", () => {
    const modifier = "contract T { function mint(address to, uint a) public onlyOwner { } }";
    const check = "contract T { address o; function mint(address to, uint a) public { require(msg.sender == o); } }";
    assert.ok(!titles(modifier).includes("Missing Access Control"));
    assert.ok(!titles(check).includes("Missing Access Control"));
});

test("The DAO's real bugs are still caught", () => {
    const found = titles(DAO);
    assert.ok(found.includes("Use of tx.origin for Authorization"));
    assert.ok(found.some((title) => /Reentrancy/.test(title)));
});

test("finding lines still point at the code once comments are blanked", () => {
    const issue = analyzeSecurity(DAO).issues.find((entry) => entry.title === "Use of tx.origin for Authorization");
    assert.ok(issue?.line !== undefined && DAO.split("\n")[issue.line - 1].includes("tx.origin"));
});
