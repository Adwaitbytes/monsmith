/**
 * A shared contract survives the trip through a URL.
 *
 * The whole contract rides inside the address, which is what lets a link work
 * with no account and no server to store anything, and also what makes it
 * fragile: any chat client that shortens long URLs silently cuts the payload.
 * The decoder has to tell a truncated token from a valid one rather than
 * inflating garbage, because the failure the user sees needs to say "the link
 * was cut" and not "your contract is empty".
 *
 * Found while verifying the share page by hand: a token cut in half produced
 * exactly the right message, which is worth a test so it keeps doing that.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeShare, encodeShare, parseShareFragment } from "../lib/shareLink.ts";

const CONTRACT = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Vault {
    mapping(address => uint256) public balances;
    function deposit() external payable { balances[msg.sender] += msg.value; }
}`;

test("a contract comes back exactly as it went in", async () => {
    const token = await encodeShare(CONTRACT);
    assert.equal(await decodeShare(token), CONTRACT);
});

test("the token is safe to put in a URL", async () => {
    const token = await encodeShare(CONTRACT);
    // Anything outside this set would need escaping, and an escaped token is
    // one a chat client can mangle differently from how we wrote it.
    assert.match(token, /^[A-Za-z0-9._~-]+$/);
});

test("a truncated token is rejected rather than half-inflated", async () => {
    const token = await encodeShare(CONTRACT);
    const half = token.slice(0, Math.floor(token.length / 2));

    // This is the real-world case: a chat client shortened the link. Returning
    // null is what lets the page say the link was cut instead of showing an
    // empty contract as though that were the shared one.
    assert.equal(await decodeShare(half), null);
});

test("nonsense decodes to null, not to an exception", async () => {
    for (const bad of ["", "nonsense", "1z.", "1z.!!!!", "9q.abcdef"]) {
        assert.equal(await decodeShare(bad), null, bad);
    }
});

test("a fragment carries both the view and the contract", async () => {
    const token = await encodeShare(CONTRACT);
    const parsed = parseShareFragment(`#v=chainfit&c=${token}`);

    assert.equal(parsed?.view, "chainfit");
    assert.equal(parsed?.source, token);
});

test("a fragment missing either half is not a share link", () => {
    assert.equal(parseShareFragment("#v=chainfit"), null);
    assert.equal(parseShareFragment("#c=1z.abc"), null);
    assert.equal(parseShareFragment(""), null);
    // An unknown view would route to a panel that does not exist.
    assert.equal(parseShareFragment("#v=nonsense&c=1z.abc"), null);
});

test("a large contract still fits and still round trips", async () => {
    const big = `${CONTRACT}\n${"    // padding that compresses well\n".repeat(400)}`;
    const token = await encodeShare(big);

    assert.equal(await decodeShare(token), big);
    // Compression is the reason this is shareable at all: uncompressed it would
    // be past what several chat clients will carry.
    assert.ok(token.length < big.length / 4, `token ${token.length} vs source ${big.length}`);
});
