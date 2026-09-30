/**
 * Who may optimize, and what it costs them. One row per case in the offer.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { decideOptimize, FREE_OPTIMIZATIONS, type OptimizeAsk } from "../lib/optimize/allowance.ts";

const base: OptimizeAsk = { paywall: true, signedIn: true, unlimited: false, freeUsed: 0, freeAllowance: 2, reportPaid: false };

test("two optimizations are free by default", () => {
    assert.equal(FREE_OPTIMIZATIONS, 2);
});

test("with the paywall off everyone may optimize and nothing is counted", () => {
    assert.deepEqual(decideOptimize({ ...base, paywall: false, signedIn: false }), { allowed: true, free: false });
});

test("signed out is asked to sign in, which is free", () => {
    const decision = decideOptimize({ ...base, signedIn: false });
    assert.equal(decision.allowed, false);
    assert.equal(decision.allowed === false && decision.reason, "sign-in");
});

test("the first and second optimizations are free", () => {
    assert.deepEqual(decideOptimize({ ...base, freeUsed: 0 }), { allowed: true, free: true });
    assert.deepEqual(decideOptimize({ ...base, freeUsed: 1 }), { allowed: true, free: true });
});

test("the third needs the report paid for", () => {
    const decision = decideOptimize({ ...base, freeUsed: 2 });
    assert.equal(decision.allowed === false && decision.reason, "pay");
});

test("a paid report may be optimized without using a free one", () => {
    assert.deepEqual(decideOptimize({ ...base, freeUsed: 2, reportPaid: true }), { allowed: true, free: false });
});

test("a paid report does not burn a free optimization while some are left", () => {
    assert.deepEqual(decideOptimize({ ...base, freeUsed: 0, reportPaid: true }), { allowed: true, free: false });
});

test("an unlimited tier is never counted", () => {
    assert.deepEqual(decideOptimize({ ...base, unlimited: true, freeUsed: 9 }), { allowed: true, free: false });
});
