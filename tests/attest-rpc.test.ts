/**
 * The RPC layer behind Monsmith's onchain checks: Alchemy URLs per chain, and
 * reading an EIP-1967 implementation slot.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";

import { alchemyUrl, implementationFromSlot, supportsChain } from "../lib/attest/rpc.ts";

test("Alchemy is used for the chains it serves, and only with a key", () => {
    const key = "abcdefghijklmnop1234";
    assert.equal(alchemyUrl(143, key), `https://monad-mainnet.g.alchemy.com/v2/${key}`);
    assert.equal(alchemyUrl(10143, key), `https://monad-testnet.g.alchemy.com/v2/${key}`);
    assert.equal(alchemyUrl(11155111, key), `https://eth-sepolia.g.alchemy.com/v2/${key}`);
    assert.equal(alchemyUrl(143, undefined), null);
    assert.equal(alchemyUrl(143, "short"), null);
    // A key is never spliced into a URL if it could change the URL's shape.
    assert.equal(alchemyUrl(143, "abcdefghijklmnop/../evil"), null);
    assert.equal(alchemyUrl(42161, key), null);
    assert.equal(supportsChain(42161), false);
    assert.equal(supportsChain(143), true);
});

test("an empty implementation slot means not a proxy", () => {
    assert.equal(implementationFromSlot(`0x${"0".repeat(64)}`), null);
    assert.equal(implementationFromSlot(undefined), null);
    assert.equal(implementationFromSlot("0x1234"), null);
});

test("a set slot gives the implementation address, checksummed", () => {
    const lower = "0x5a2a4e5a8e0e2a1b2c3d4e5f60718293a4b5c6d7";
    assert.equal(implementationFromSlot(`0x${"0".repeat(24)}${lower.slice(2)}`), getAddress(lower));
});
