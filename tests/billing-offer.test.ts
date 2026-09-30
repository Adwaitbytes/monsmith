/**
 * What the start screen and the unlock panel say about money.
 *
 * The rule under test: the words follow the server's facts. No price is printed
 * that checkout would not charge, and nothing about paying is printed when the
 * paywall is off.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { formatPrice, freeReportsPhrase, offerHeadline } from "../lib/billing/offer.ts";

test("prices print in the currency's own format", () => {
    assert.equal(formatPrice({ amount: 1099, currency: "USD" }), "$10.99");
    assert.equal(formatPrice({ amount: 1000, currency: "USD" }), "$10");
});

test("an unknown currency code still prints", () => {
    assert.equal(formatPrice({ amount: 1099, currency: "NOPE" }), "10.99 NOPE");
});

test("the free allowance reads as words", () => {
    assert.equal(freeReportsPhrase(2), "two full reports");
    assert.equal(freeReportsPhrase(1), "one full report");
    assert.equal(freeReportsPhrase(12), "12 full reports");
});

test("with a paywall and a price, the offer names both", () => {
    assert.equal(
        offerHeadline({ paywall: true, freeReports: 2, price: { amount: 1099, currency: "USD" } }),
        "Two full reports free with an account. Then $10.99 per report.",
    );
});

test("without a known price, no number is invented", () => {
    assert.equal(
        offerHeadline({ paywall: true, freeReports: 2, price: null }),
        "Two full reports free with an account.",
    );
});

test("with the paywall off, nobody is told they will pay", () => {
    const line = offerHeadline({ paywall: false, freeReports: 2, price: { amount: 1099, currency: "USD" } });
    assert.ok(line !== null && !line.includes("$"));
});

test("no free allowance and no price means nothing to say", () => {
    assert.equal(offerHeadline({ paywall: true, freeReports: 0, price: null }), null);
});
