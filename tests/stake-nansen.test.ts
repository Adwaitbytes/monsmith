/**
 * Turning Nansen's balances and counterparties into what is at stake.
 *
 * Built from rows shaped like Nansen's documented responses, so the summary is
 * tested without spending credits.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { nansenChain, summariseStake } from "../lib/stake/nansen.ts";

test("only chains Nansen covers are asked about", () => {
    assert.equal(nansenChain(143), "monad");
    assert.equal(nansenChain(1), "ethereum");
    assert.equal(nansenChain(10143), null);
    assert.equal(nansenChain(11155111), null);
});

test("holdings are totalled and ranked, and worthless dust is left out", () => {
    const stake = summariseStake(
        "monad",
        "0xabc",
        [
            { token_symbol: "WMON", token_amount: 1000, value_usd: 3200.5 },
            { token_symbol: "USDC", token_amount: "250000", value_usd: "250000" },
            { token_symbol: "DUST", token_amount: 5, value_usd: 0 },
        ],
        [],
        30,
    );
    assert.equal(stake.heldUsd, 253200.5);
    assert.deepEqual(stake.holdings.map((holding) => holding.symbol), ["USDC", "WMON"]);
    assert.equal(stake.labelledVolumeShare, null);
});

test("counterparties are ranked by volume, and the labelled share is by volume, not by count", () => {
    const stake = summariseStake(
        "monad",
        "0xabc",
        [],
        [
            { counterparty_address: "0x1", counterparty_address_label: ["Smart Trader", "Fund"], interaction_count: 3, total_volume_usd: 900 },
            { counterparty_address: "0x2", counterparty_address_label: null, interaction_count: 40, total_volume_usd: 100 },
            { counterparty_address: "0x3", counterparty_address_label: "  ", interaction_count: 1, total_volume_usd: 0 },
            { counterparty_address: 7, interaction_count: 1, total_volume_usd: 5 },
        ],
        30,
    );
    assert.deepEqual(stake.counterparties.map((party) => party.address), ["0x1", "0x2", "0x3"]);
    assert.equal(stake.counterparties[0]?.label, "Smart Trader, Fund");
    assert.equal(stake.counterparties[2]?.label, null);
    assert.equal(stake.labelledVolumeShare, 0.9);
});
