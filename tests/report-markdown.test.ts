/**
 * The downloaded report.
 *
 * What matters: it carries everything the reader could see and nothing more,
 * and it does not fall over on a report with sections missing or failed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { reportFileName, reportToMarkdown } from "../lib/report/markdown.ts";
import { redactReport } from "../lib/report/redact.ts";
import { countBySeverity, type Finding, type RepoReport } from "../lib/report/types.ts";

function finding(id: string, severity: Finding["severity"]): Finding {
    return {
        id,
        severity,
        title: `Finding ${id} — with a dash`,
        source: "security",
        file: "contracts/Vault.sol",
        line: 42,
        description: `DESCRIPTION-${id}`,
        evidence: `EVIDENCE-${id}`,
        fix: `FIX-${id}`,
    };
}

function report(findings: Finding[]): RepoReport {
    return {
        reportId: "r1",
        createdAt: "2026-10-01T00:00:00.000Z",
        origin: { kind: "github", owner: "Uniswap", repo: "v2-core", ref: "master", private: false },
        health: { score: 61, grade: "C", headline: "" },
        counts: countBySeverity(findings),
        contracts: [
            {
                id: "contracts/Vault.sol",
                path: "contracts/Vault.sol",
                name: "Vault",
                health: { score: 61, grade: "C", headline: "" },
                findings,
                counts: countBySeverity(findings),
                sections: {
                    security: { status: "ok", data: { issues: [] }, durationMs: 1 },
                    parallel: { status: "failed", failure: { reason: "timed out", timedOut: true } },
                    gas: {
                        status: "ok",
                        durationMs: 1,
                        data: {
                            contractName: "Vault",
                            deployment: { totalCost: 512000 },
                            functions: [
                                { name: "swap", signature: "swap(uint256|uint256)", gas: 91000 },
                                { name: "sync", signature: "sync()", gas: null },
                            ],
                            internalFunctions: [],
                            contractSizeBytes: 9000,
                            contractSizeLimitBytes: 24576,
                            summary: {},
                            warnings: [],
                        } as never,
                    },
                    chainfit: { status: "pending" },
                },
            },
        ],
        skipped: [],
        notes: [],
        redacted: false,
    };
}

const ALL = [finding("a", "critical"), finding("b", "high"), finding("c", "low"), finding("d", "info")];

test("the full report carries every finding with its fix and location", () => {
    const markdown = reportToMarkdown(report(ALL), "https://www.monsmith.com/report/r1");
    assert.match(markdown, /# Contract audit: Uniswap\/v2-core/);
    assert.match(markdown, /Overall score: 61 \/ 100 \(C\)/);
    for (const id of ["a", "b", "c", "d"]) {
        assert.ok(markdown.includes(`FIX-${id}`));
        assert.ok(markdown.includes(`EVIDENCE-${id}`));
    }
    assert.ok(markdown.includes("`contracts/Vault.sol:42`"));
    assert.ok(markdown.includes("https://www.monsmith.com/report/r1"));
});

test("a redacted report downloads as redacted: locked findings keep only their title", () => {
    const markdown = reportToMarkdown(redactReport(report(ALL), false));
    assert.ok(!markdown.includes("FIX-a"), "the critical finding's fix must not leak");
    assert.ok(!markdown.includes("EVIDENCE-b"), "the high finding's evidence must not leak");
    assert.match(markdown, /Details are in the full report/);
    assert.match(markdown, /This is the free view/);
});

test("the gas table lists every function, marks unbounded ones, and escapes pipes", () => {
    const markdown = reportToMarkdown(report(ALL));
    assert.ok(markdown.includes("| `swap(uint256\\|uint256)` | 91,000 |"));
    assert.ok(markdown.includes("| `sync()` | unbounded |"));
});

test("a failed or pending section is left out rather than breaking the download", () => {
    const markdown = reportToMarkdown(report(ALL));
    assert.ok(!markdown.includes("Parallel execution"));
    assert.ok(!markdown.includes("Deploy cost by chain"));
});

test("no long dashes reach the document", () => {
    assert.ok(!reportToMarkdown(report(ALL)).includes("—"));
});

test("the file name is safe and dated", () => {
    assert.equal(reportFileName(report(ALL), "md"), "monsmith-uniswap-v2-core-2026-10-01.md");
});
