/**
 * A fix review that re-audits the whole contract, not just the lines it touched.
 *
 * The earlier review kept a new finding only if it sat within two lines of an
 * edit, on the theory that nothing else changed. A security reviewer pointed out
 * the hole: a fix in one place can break something unrelated, and those
 * findings were being thrown away. These pin the replacement: every new finding
 * is kept and labelled by where it sits, nothing already carried forward is
 * reported twice, invariants the original contract promised are checked
 * against the fixed code, and a finding masked by another one says so.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { __testing, toFindings, type AuditFinding } from "../lib/report/audit.ts";

const { classifyFixReviewFindings, parseInvariantCheck, normalizeFindings } = __testing;

function finding(title: string, line: number | null, extra: Partial<AuditFinding> = {}): AuditFinding {
    return {
        title,
        severity: "high",
        confidence: 0.8,
        line,
        evidence: "",
        attack: "",
        impact: "",
        fix: "",
        ...extra,
    };
}

const SOURCE = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join("\n");

test("a new finding far from the edit is kept and labelled elsewhere", () => {
    const out = classifyFixReviewFindings([finding("Unchecked return value in sweep", 50)], [], [10, 11]);
    assert.equal(out.length, 1);
    assert.equal(out[0].scope, "elsewhere");
});

test("a new finding next to the edit is labelled as in the changed code", () => {
    const out = classifyFixReviewFindings([finding("Reentrancy in withdraw", 12)], [], [10, 11]);
    assert.equal(out[0].scope, "changed");
});

test("a finding already carried forward is not reported a second time", () => {
    const carried = [finding("Reentrancy in withdraw function", 30)];
    const out = classifyFixReviewFindings([finding("Withdraw reentrancy before balance update", 31)], carried, [5]);
    assert.equal(out.length, 0);
});

test("a carried finding without a line still suppresses a near-identical title", () => {
    const carried = [finding("Missing access control on setOwner", null)];
    const out = classifyFixReviewFindings([finding("Missing access control on setOwner function", 44)], carried, [5]);
    assert.equal(out.length, 0);
});

test("an unrelated finding near a carried one is kept", () => {
    const carried = [finding("Reentrancy in withdraw", 30)];
    const out = classifyFixReviewFindings([finding("Integer truncation in fee math", 31)], carried, [5]);
    assert.equal(out.length, 1);
});

test("a broken invariant with a cited line and a way to break it becomes a finding", () => {
    const invariants = ["totalSupply equals the sum of all balances", "only the owner can mint"];
    const broken = parseInvariantCheck(
        invariants,
        {
            results: [
                { id: "I1", status: "broken", line: 22, severity: "critical", how: "1. call burn twice 2. supply drops below the sum" },
                { id: "I2", status: "holds", line: null },
            ],
        },
        SOURCE,
    );
    assert.equal(broken.checked, 2);
    assert.equal(broken.findings.length, 1);
    assert.equal(broken.findings[0].severity, "critical");
    assert.equal(broken.findings[0].line, 22);
    assert.equal(broken.findings[0].scope, "invariant");
    assert.match(broken.findings[0].title, /totalSupply equals the sum of all balances/);
    assert.match(broken.findings[0].evidence, /^22 \| line 22/);
});

test("a broken claim without a line or a way to break it is not reported", () => {
    const broken = parseInvariantCheck(
        ["balances never go negative"],
        { results: [{ id: "I1", status: "broken", line: null, how: "" }] },
        SOURCE,
    );
    assert.equal(broken.findings.length, 0);
    assert.equal(broken.checked, 1);
});

test("an unreadable invariant reply checks nothing and claims nothing", () => {
    const broken = parseInvariantCheck(["x"], null, SOURCE);
    assert.equal(broken.checked, 0);
    assert.equal(broken.findings.length, 0);
});

test("a finding the hunt marks as blocked by another keeps that link", () => {
    const [out] = normalizeFindings(
        [{ title: "Reward double claim", severity: "high", confidence: 0.8, lineStart: 40, blockedBy: "Reentrancy in splitDAO" }],
        SOURCE,
    );
    assert.equal(out.blockedBy, "Reentrancy in splitDAO");
});

test("the report says where a re-audit finding sits and what masks a finding", () => {
    const [elsewhere, masked] = toFindings(
        {
            description: null,
            threats: [],
            findings: [
                finding("Unchecked transfer", 50, { impact: "Funds can be lost.", scope: "elsewhere" }),
                finding("Reward double claim", 40, { impact: "Rewards paid twice.", blockedBy: "Reentrancy in splitDAO" }),
            ],
            rejected: [],
            complete: true,
            notes: [],
        },
        "c1",
    );
    assert.match(elsewhere.description ?? "", /away from the lines the fix changed/);
    assert.match(masked.description ?? "", /Reentrancy in splitDAO/);
});

test("a new finding the model matches to a known one is dropped, and only ids it was asked about", () => {
    const { dropKnownDefects } = __testing;
    const fresh = [finding("Duplicate stakers over-credit rewards", 52), finding("Fee can exceed the pool", 47)];
    assert.deepEqual(
        dropKnownDefects(fresh, { duplicates: [{ id: "N1", known: "K2" }, { id: "N9", known: "K1" }] }).map((f) => f.title),
        ["Fee can exceed the pool"],
    );
});

test("an unreadable dedup reply drops nothing", () => {
    const { dropKnownDefects } = __testing;
    const fresh = [finding("Duplicate stakers over-credit rewards", 52)];
    assert.equal(dropKnownDefects(fresh, null).length, 1);
    assert.equal(dropKnownDefects(fresh, { duplicates: [{ id: "N1" }] }).length, 1);
});
