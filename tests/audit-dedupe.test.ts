/**
 * One defect, one finding.
 *
 * A real run produced the same reentrancy twice, once as "Reentrancy
 * vulnerability in withdraw function" and once as "Multiple withdrawals before
 * balance update". Both true, both about the same line, and together they make
 * a report look padded. A reader who notices padding stops trusting the parts
 * they have not checked, which costs far more than the duplicate itself.
 *
 * These pin the two properties that matter: near-identical findings about the
 * same place collapse, and the collapse never quietly downgrades a critical.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { __testing } from "../lib/report/audit.ts";

const { dedupe } = __testing;

function finding(
    title: string,
    line: number | null,
    severity: "critical" | "high" | "medium" | "low" | "info" = "high",
    confidence = 0.8,
) {
    return {
        title,
        severity,
        confidence,
        line,
        evidence: "",
        attack: "",
        impact: "",
        fix: "",
    };
}

test("the same defect described twice collapses to one", () => {
    const out = dedupe([
        finding("Reentrancy vulnerability in withdraw function", 8, "critical", 0.9),
        finding("Reentrancy in withdraw before balance update", 10, "high", 0.7),
    ]);

    assert.equal(out.length, 1);
});

test("collapsing keeps the worse severity, never the milder one", () => {
    const out = dedupe([
        finding("Reentrancy in withdraw", 10, "high", 0.7),
        finding("Reentrancy vulnerability in withdraw function", 8, "critical", 0.9),
    ]);

    assert.equal(out.length, 1);
    // Order must not decide severity: a critical arriving second still wins.
    assert.equal(out[0].severity, "critical");
    assert.equal(out[0].confidence, 0.9);
});

test("distinct defects in the same function both survive", () => {
    const out = dedupe([
        finding("Reentrancy in withdraw", 8, "critical"),
        finding("Missing access control on emergencyDrain", 9, "high"),
    ]);

    assert.equal(out.length, 2);
});

test("the same words far apart are two findings, not one", () => {
    // Two unbounded loops in different functions are genuinely two problems.
    const out = dedupe([
        finding("Unbounded loop in distribute", 20),
        finding("Unbounded loop in reclaim", 140),
    ]);

    assert.equal(out.length, 2);
});

test("findings with no line are never merged on a guess", () => {
    const out = dedupe([
        finding("Reentrancy in withdraw", null),
        finding("Reentrancy in withdraw", null),
    ]);

    // Without a location there is nothing to establish they are the same site,
    // and inventing that link would delete a real finding.
    assert.equal(out.length, 2);
});

test("common audit words alone do not collapse unrelated findings", () => {
    const out = dedupe([
        finding("Potential vulnerability in the transfer function", 30),
        finding("Possible issue in the approve function", 32),
    ]);

    // Strip the filler and these share nothing: "transfer" against "approve".
    assert.equal(out.length, 2);
});

test("an empty set stays empty", () => {
    assert.deepEqual(dedupe([]), []);
});
