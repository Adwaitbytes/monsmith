/**
 * A deploy goes where the studio said it would.
 *
 * The deployer forced Monad testnet regardless of what was selected, so
 * choosing mainnet turned the status bar red, printed "Monad mainnet", and then
 * switched the wallet to testnet and deployed there. That is precisely the
 * mistake the status bar was added to prevent, committed by the code behind it.
 *
 * These pin the chain ids and the default, because the direction of the risk is
 * asymmetric: a mainnet deploy landing on testnet wastes seconds, and the
 * reverse spends real money.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { MONAD_CHAINS, monadMainnet, monadTestnet } from "../lib/deploy.ts";

test("the two Monad chains have the ids the explorers use", () => {
    assert.equal(monadTestnet.id, 10143);
    assert.equal(monadMainnet.id, 143);
});

test("testnet and mainnet are not the same chain", () => {
    // They were: mainnet was declared with the testnet id and a note to fix it
    // later, which would have sent a mainnet deploy to testnet and verified a
    // payment signature against a chain the payer never agreed to.
    assert.notEqual(monadTestnet.id, monadMainnet.id);
});

test("each chain carries its own rpc and explorer", () => {
    for (const chain of [monadTestnet, monadMainnet]) {
        assert.ok(chain.rpcUrls.default.http[0].startsWith("https://"), chain.name);
        assert.ok(chain.blockExplorers.default.url.startsWith("https://"), chain.name);
    }
    assert.notEqual(
        monadTestnet.rpcUrls.default.http[0],
        monadMainnet.rpcUrls.default.http[0],
    );
    assert.notEqual(
        monadTestnet.blockExplorers.default.url,
        monadMainnet.blockExplorers.default.url,
    );
});

test("the network name maps to the chain it names", () => {
    assert.equal(MONAD_CHAINS.testnet.id, monadTestnet.id);
    assert.equal(MONAD_CHAINS.mainnet.id, monadMainnet.id);
});

test("both chains price in MON", () => {
    for (const chain of [monadTestnet, monadMainnet]) {
        assert.equal(chain.nativeCurrency.symbol, "MON");
        assert.equal(chain.nativeCurrency.decimals, 18);
    }
});
