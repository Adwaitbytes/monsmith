/**
 * The Monad gas model checked against the worked examples in the specification.
 *
 * Run with `npm run test:chainfit`. These assertions are the reason the numbers
 * in a Chain Fit report can be quoted: if Monad reprices something, the example
 * table stops matching and this fails.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    MONAD_COST_EXAMPLES,
    accountAccessGas,
    ethereumStorageGas,
    intrinsicGas,
    memoryGas,
    monadStorageGas,
    pageIndex,
    precompileSurcharge,
    type StorageAccess,
} from "../lib/chainfit/schedules.ts";

test("storage page index strips the low 7 bits", () => {
    assert.equal(pageIndex(0n), 0n);
    assert.equal(pageIndex(127n), 0n);
    assert.equal(pageIndex(128n), 1n);
    assert.equal(pageIndex(255n), 1n);
    assert.equal(pageIndex(256n), 2n);
});

test("monad storage model reproduces every worked example in the spec", () => {
    for (const example of MONAD_COST_EXAMPLES) {
        assert.equal(
            monadStorageGas(example.accesses),
            example.expectedGas,
            example.description,
        );
    }
});

test("state growth is a high-water mark, so a replaced slot is not charged twice", () => {
    const create = (slot: bigint): StorageAccess => ({
        account: "a",
        slot,
        kind: "store",
        createsSlot: true,
        clearsSlot: false,
        changesValue: true,
    });
    const clear = (slot: bigint): StorageAccess => ({
        account: "a",
        slot,
        kind: "store",
        createsSlot: false,
        clearsSlot: true,
        changesValue: true,
    });

    // Create, clear, then create again in the same page. Net slots peaks at 1,
    // so growth is charged once: 27900 + 100 + 100.
    assert.equal(monadStorageGas([create(0n), clear(0n), create(1n)]), 28_100);

    // Two slots created and kept. Net slots reaches 2, so growth is charged
    // twice: 27900 + (100 + 17000).
    assert.equal(monadStorageGas([create(0n), create(1n)]), 45_000);
});

test("pages are tracked per account, not globally", () => {
    const load = (account: string): StorageAccess => ({
        account,
        slot: 0n,
        kind: "load",
        createsSlot: false,
        clearsSlot: false,
        changesValue: false,
    });
    assert.equal(monadStorageGas([load("a"), load("a")]), 8_100 + 100);
    assert.equal(monadStorageGas([load("a"), load("b")]), 8_100 + 8_100);
});

test("reading a full 128-slot page is cheaper on monad, a scattered read is not", () => {
    const load = (slot: bigint): StorageAccess => ({
        account: "a",
        slot,
        kind: "load",
        createsSlot: false,
        clearsSlot: false,
        changesValue: false,
    });

    const packed = Array.from({ length: 8 }, (_, i) => load(BigInt(i)));
    assert.equal(monadStorageGas(packed), 8_100 + 7 * 100);
    assert.equal(ethereumStorageGas(packed), 8 * 2_100);
    assert.ok(monadStorageGas(packed) < ethereumStorageGas(packed));

    // One slot per page: Monad pays the page load every time.
    const scattered = Array.from({ length: 8 }, (_, i) => load(BigInt(i) * 128n));
    assert.equal(monadStorageGas(scattered), 8 * 8_100);
    assert.ok(monadStorageGas(scattered) > ethereumStorageGas(scattered));
});

test("the break-even point for a packed read is the fourth slot in a page", () => {
    const load = (slot: bigint): StorageAccess => ({
        account: "a",
        slot,
        kind: "load",
        createsSlot: false,
        clearsSlot: false,
        changesValue: false,
    });
    const cost = (n: number) => {
        const ops = Array.from({ length: n }, (_, i) => load(BigInt(i)));
        return { monad: monadStorageGas(ops), ethereum: ethereumStorageGas(ops) };
    };

    // 3 slots: Monad 8300 vs Ethereum 6300. 4 slots: Monad 8400 vs Ethereum 8400.
    assert.ok(cost(3).monad > cost(3).ethereum);
    assert.equal(cost(4).monad, cost(4).ethereum);
    assert.ok(cost(5).monad < cost(5).ethereum);
});

test("cold account access costs 3.9x more on monad, warm access is identical", () => {
    const one = [{ address: "0xabc", opcode: "CALL" }];
    assert.equal(accountAccessGas(one, "ethereum"), 2_600);
    assert.equal(accountAccessGas(one, "monad"), 10_100);

    const repeated = [
        { address: "0xabc", opcode: "CALL" },
        { address: "0xabc", opcode: "CALL" },
    ];
    assert.equal(accountAccessGas(repeated, "ethereum"), 2_700);
    assert.equal(accountAccessGas(repeated, "monad"), 10_200);
});

test("memory expansion is linear on monad and quadratic on ethereum", () => {
    assert.equal(memoryGas(0, "monad"), 0);
    assert.equal(memoryGas(0, "ethereum"), 0);

    // Small allocations barely differ.
    assert.equal(memoryGas(4, "ethereum"), 12);
    assert.equal(memoryGas(4, "monad"), 2);

    // Expanding to the 8 MB cap costs 131,072 gas on Monad, per the spec.
    const capWords = 8_388_608 / 32;
    assert.equal(memoryGas(capWords, "monad"), 131_072);
    // The same allocation on Ethereum is more than 100x that.
    assert.ok(memoryGas(capWords, "ethereum") > 100 * 131_072);
});

test("precompile surcharges follow the published multipliers", () => {
    assert.equal(precompileSurcharge(0x01, 3_000), 3_000); // ecRecover 2x
    assert.equal(precompileSurcharge(0x07, 6_000), 24_000); // ecMul 5x
    assert.equal(precompileSurcharge(0x0a, 50_000), 150_000); // point eval 4x
    // A pairing over two points: 45000 + 2*34000 = 113000, charged 5x.
    assert.equal(precompileSurcharge(0x08, 113_000), 452_000);
    // Untouched precompiles cost the same on both chains.
    assert.equal(precompileSurcharge(0x02, 60), 0);
    assert.equal(precompileSurcharge(0x05, 1_000), 0);
});

test("intrinsic gas counts calldata bytes and init code words", () => {
    assert.equal(intrinsicGas(new Uint8Array(0), false), 21_000);
    assert.equal(intrinsicGas(new Uint8Array([0, 0, 0]), false), 21_000 + 12);
    assert.equal(intrinsicGas(new Uint8Array([1, 2, 3]), false), 21_000 + 48);
    // 32 non-zero bytes of init code: 21000 + 32*16 + 2*1 word.
    assert.equal(intrinsicGas(new Uint8Array(32).fill(1), true), 21_000 + 512 + 2);
});
