/**
 * The paywall is a server-side guarantee, not a CSS effect.
 *
 * Everything worth charging for in a report is also everything an attacker
 * would look for first, and this audience opens dev tools by reflex. So the
 * property these tests defend is blunt: a redacted report must not contain a
 * paid field anywhere in its object graph, whatever shape the report had going
 * in. The deep walk at the end is the real test. The ones before it explain
 * what is supposed to survive redaction and why.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { redactReport, summariseLocked } from "../lib/report/redact.ts";
import { countBySeverity, emptyCounts, type Finding, type RepoReport } from "../lib/report/types.ts";

/** Paid fields, by the names they carry on a Finding. */
const PAID_KEYS = ["description", "evidence", "fix", "patch", "line", "file"] as const;

function finding(id: string, severity: Finding["severity"]): Finding {
    return {
        id,
        severity,
        title: `Finding ${id}`,
        source: "security",
        file: "contracts/Vault.sol",
        line: 42,
        description: `PAID-DESCRIPTION-${id}`,
        evidence: `PAID-EVIDENCE-${id}`,
        fix: `PAID-FIX-${id}`,
        patch: `PAID-PATCH-${id}`,
    };
}

function report(findings: Finding[]): RepoReport {
    return {
        reportId: "r1",
        createdAt: "2026-09-21T00:00:00.000Z",
        origin: { kind: "workspace" },
        health: { score: 61, grade: "C", headline: "One critical issue to resolve." },
        counts: countBySeverity(findings),
        contracts: [
            {
                id: "contracts/Vault.sol",
                path: "contracts/Vault.sol",
                name: "Vault",
                health: { score: 61, grade: "C", headline: "One critical issue to resolve." },
                findings,
                counts: countBySeverity(findings),
                sections: {
                    security: { status: "ok", data: { issues: [] }, durationMs: 12 },
                    parallel: { status: "failed", failure: { reason: "Exceeded budget", timedOut: true } },
                    gas: { status: "ok", data: { PAID: "GAS-PROFILE" } as never, durationMs: 30 },
                    chainfit: { status: "pending" },
                },
            },
        ],
        skipped: [],
        notes: ["A repository is as safe as its worst contract."],
        redacted: false,
    };
}

const ALL = [
    finding("a", "critical"),
    finding("b", "high"),
    finding("c", "medium"),
    finding("d", "low"),
    finding("e", "info"),
];

test("an entitled viewer gets the report untouched", () => {
    const full = redactReport(report(ALL), true);

    assert.equal(full.redacted, false);
    assert.equal(full.contracts[0].findings.length, 5);
    for (const found of full.contracts[0].findings) {
        assert.equal(found.evidence, `PAID-EVIDENCE-${found.id}`);
        assert.equal(found.patch, `PAID-PATCH-${found.id}`);
    }
});

test("counts stay true after redaction, because the count is the sales pitch", () => {
    const free = redactReport(report(ALL), false);

    assert.equal(free.redacted, true);
    // Every finding is still listed. Hiding their number would make the paid
    // report unverifiable, which is the one thing the free half has to prove.
    assert.equal(free.contracts[0].findings.length, 5);
    assert.deepEqual(free.contracts[0].counts, {
        critical: 1,
        high: 1,
        medium: 1,
        low: 1,
        info: 1,
    });
});

test("the two mildest findings are given away, never the worst", () => {
    const free = redactReport(report(ALL), false);
    const byId = new Map(free.contracts[0].findings.map((f) => [f.id, f]));

    // Least severe end: info and low.
    assert.equal(byId.get("e")?.evidence, "PAID-EVIDENCE-e");
    assert.equal(byId.get("d")?.evidence, "PAID-EVIDENCE-d");

    // Everything more severe is withheld, the critical one above all.
    assert.equal(byId.get("a")?.evidence, undefined);
    assert.equal(byId.get("b")?.evidence, undefined);
    assert.equal(byId.get("c")?.evidence, undefined);
});

test("severity and title survive redaction so a locked finding is still provable", () => {
    const free = redactReport(report(ALL), false);
    const critical = free.contracts[0].findings.find((f) => f.id === "a");

    assert.equal(critical?.severity, "critical");
    assert.equal(critical?.title, "Finding a");
    assert.equal(critical?.source, "security");
});

test("a withheld finding omits paid keys rather than emptying them", () => {
    const free = redactReport(report(ALL), false);
    const critical = free.contracts[0].findings.find((f) => f.id === "a");
    assert.ok(critical !== undefined);

    // Absent, not "". A consumer that forgets to check `redacted` should get
    // undefined and fail visibly, not render a convincing blank.
    for (const key of PAID_KEYS) {
        assert.equal(Object.prototype.hasOwnProperty.call(critical, key), false, key);
    }
});

test("section analysis payloads do not survive, but their status does", () => {
    const free = redactReport(report(ALL), false);
    const sections = free.contracts[0].sections;

    assert.equal(sections.gas.status, "ok");
    assert.equal(sections.gas.status === "ok" ? sections.gas.data : "unset", undefined);

    // Knowing a section could not be measured is free information: it tells a
    // reader what the paid report would and would not contain.
    assert.equal(sections.parallel.status, "failed");
    assert.equal(sections.chainfit.status, "pending");
});

test("no withheld finding's text appears anywhere in a redacted report", () => {
    const free = redactReport(report(ALL), false);
    const serialised = JSON.stringify(free);

    // The whole object graph is searched rather than the fields we happen to
    // remember, because the leak that matters is the one through a field nobody
    // thought about.
    for (const id of ["a", "b", "c"]) {
        for (const kind of ["DESCRIPTION", "EVIDENCE", "FIX", "PATCH"]) {
            const marker = `PAID-${kind}-${id}`;
            assert.equal(serialised.includes(marker), false, `${marker} leaked`);
        }
    }

    // A section's analysis is paid in full, with no free sample.
    assert.equal(serialised.includes("GAS-PROFILE"), false, "gas profile leaked");

    // The two given away deliberately are still present, so this test cannot
    // pass by redacting everything.
    assert.equal(serialised.includes("PAID-EVIDENCE-d"), true);
    assert.equal(serialised.includes("PAID-EVIDENCE-e"), true);
});

test("redaction survives a report with no findings and no health", () => {
    const empty: RepoReport = {
        ...report([]),
        health: null,
        counts: emptyCounts(),
        contracts: [{ ...report([]).contracts[0], findings: [], health: null, counts: emptyCounts() }],
    };

    const free = redactReport(empty, false);
    assert.equal(free.contracts[0].findings.length, 0);
    assert.equal(free.contracts[0].health, null);
});

test("the upsell counts only what is actually withheld", () => {
    const summary = summariseLocked(report(ALL));

    // Five findings, two given away.
    assert.equal(summary.lockedFindings, 3);
    assert.equal(summary.contractsMeasured, 1);
    assert.equal(summary.hasPatches, true);
    // chainfit was pending, so the upsell must not promise a comparison.
    assert.equal(summary.hasChainFit, false);
});

test("the upsell promises nothing when there is nothing behind the lock", () => {
    const summary = summariseLocked(report([finding("a", "low"), finding("b", "info")]));
    assert.equal(summary.lockedFindings, 0);
});
