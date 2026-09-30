/**
 * How many reports someone gets before being asked to pay.
 *
 * The allowance is counted by creation order: an owner's earliest reports are the
 * free ones, forever. Counting any other way (say, "the last two", or "two per
 * day") would let a report that was free yesterday lock itself today, and a
 * person who shared a free report's link would find it paywalled later.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { FREE_REPORTS, freeAllowanceFor, freeReportAllowance, isFreeReport } from "../lib/report/freeReports.ts";

test("free reports need an account: a signed-out visitor's allowance is zero", () => {
    assert.equal(freeAllowanceFor({ userId: null, visitorId: "v_1" }), 0);
    assert.equal(freeAllowanceFor({ userId: null, visitorId: null }), 0);
});

test("a signed-in person gets the full allowance", () => {
    assert.equal(freeAllowanceFor({ userId: "user_1", visitorId: "v_1" }), FREE_REPORTS);
    assert.equal(freeAllowanceFor({ userId: "user_1", visitorId: null }), FREE_REPORTS);
});

test("a signed-out visitor's first report is not free, however early it was", () => {
    const owner = { userId: null, visitorId: "v_1" };
    assert.equal(isFreeReport("r1", ["r1"], freeAllowanceFor(owner)), false);
});

test("two reports are free by default", () => {
    assert.equal(FREE_REPORTS, 2);
});

test("an owner's first and second reports are free", () => {
    const earliest = ["r1", "r2"];
    assert.equal(isFreeReport("r1", earliest), true);
    assert.equal(isFreeReport("r2", earliest), true);
});

test("the third report is not free", () => {
    assert.equal(isFreeReport("r3", ["r1", "r2"]), false);
});

test("an owner with no history has no free report to match", () => {
    assert.equal(isFreeReport("r1", []), false);
});

test("the check never looks past the allowance, even if handed more rows", () => {
    assert.equal(isFreeReport("r3", ["r1", "r2", "r3"], 2), false);
    assert.equal(isFreeReport("r3", ["r1", "r2", "r3"], 3), true);
});

test("the allowance can be tuned from the environment and falls back on nonsense", () => {
    assert.equal(freeReportAllowance(undefined), 2);
    assert.equal(freeReportAllowance(""), 2);
    assert.equal(freeReportAllowance("5"), 5);
    assert.equal(freeReportAllowance("0"), 0);
    assert.equal(freeReportAllowance("-1"), 2);
    assert.equal(freeReportAllowance("two"), 2);
    assert.equal(freeReportAllowance("1000"), 50);
});
