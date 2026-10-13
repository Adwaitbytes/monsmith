/**
 * Failing safe when a proxy is upgraded between a check and a call.
 *
 * The caller hands back the implementation its answer was about. Anything other
 * than that same implementation, including garbage, must come back stale and
 * not attested: a check that passes on doubt is not a check.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { isStale, staleAnswer } from "../lib/attest/proxyCheck.ts";

const IMPL = "0x5FAab9E1adbddaD0a08734BE8a52185Fd6558E14";

test("no expectation means no staleness: a first check just answers", () => {
    assert.equal(isStale(null, IMPL), false);
});

test("the same implementation in any letter case is still current", () => {
    assert.equal(isStale(IMPL.toLowerCase(), IMPL), false);
});

test("a different implementation is stale", () => {
    assert.equal(isStale("0x0000000000000000000000000000000000000001", IMPL), true);
});

test("an expectation that is not an address fails closed", () => {
    assert.equal(isStale("latest", IMPL), true);
    assert.equal(isStale("0x1234", IMPL), true);
});

test("a stale answer is never attested and names both implementations", () => {
    const answer = staleAnswer("0x0000000000000000000000000000000000000001", IMPL);
    assert.equal(answer.attested, false);
    assert.equal(answer.stale, true);
    assert.equal(answer.implementation, IMPL);
    assert.match(answer.reason, /Do not call it/);
});
