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

const SEND_THEN_WRITE = `contract V {
    mapping(address => uint256) public rewardOf;
    function claim() external {
        uint256 reward = rewardOf[msg.sender];
        (bool ok, ) = msg.sender.call{value: reward}("");
        require(ok);
        rewardOf[msg.sender] = 0;
    }
}`;

const WRITE_THEN_SEND = `contract V {
    mapping(address => uint256) public stakeOf;
    uint256 public totalStaked;
    function unstake(uint256 amount) external {
        uint256 staked = stakeOf[msg.sender];
        stakeOf[msg.sender] = staked - amount;
        totalStaked -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert();
        bool done = true;
    }
}`;

test("a value call followed by a state write is reentrancy, and points at the call", () => {
    const issue = analyzeSecurity(SEND_THEN_WRITE).issues.find((entry) => /Reentrancy/.test(entry.title));
    assert.ok(issue !== undefined);
    assert.equal(issue.line, 5);
});

test("checks-effects-interactions is not flagged, even with locals written after the call", () => {
    assert.ok(!titles(WRITE_THEN_SEND).some((title) => /Reentrancy/.test(title)));
});

test("a guard silences the rule", () => {
    assert.ok(!titles(SEND_THEN_WRITE.replace("external {", "external nonReentrant {")).some((title) => /Reentrancy/.test(title)));
});

test("a value call inside an internal helper is followed into the caller that writes after it", () => {
    const issue = analyzeSecurity(DAO).issues.find((entry) => /Reentrancy/.test(entry.title));
    assert.ok(issue?.line !== undefined && /payOut\(|call\{value:/.test(DAO.split("\n")[issue.line - 1]));
});
