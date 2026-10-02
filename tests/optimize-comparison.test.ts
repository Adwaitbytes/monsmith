/**
 * The downloadable before-and-after of an optimization.
 *
 * The diff must apply: a reviewer may well feed it to `git apply`, so a wrong
 * hunk header is a broken download, not a cosmetic slip.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { optimizationToMarkdown, unifiedDiff } from "../lib/optimize/comparison.ts";
import type { OptimizeResult } from "../lib/optimize/types.ts";

const BEFORE = ["pragma solidity ^0.8.24;", "contract V {", "    uint a;", "    function f() public {", "        a = 1;", "    }", "}", ""].join("\n");
const AFTER = ["pragma solidity ^0.8.24;", "contract V {", "    uint a;", "    error Nope();", "    function f() public {", "        a = 2;", "    }", "}", ""].join("\n");

test("the diff marks exactly the added and removed lines", () => {
    const diff = unifiedDiff(BEFORE, AFTER, "contracts/V.sol");
    assert.ok(diff.startsWith("--- a/contracts/V.sol\n+++ b/contracts/V.sol\n@@ "));
    assert.ok(diff.includes("\n+    error Nope();"));
    assert.ok(diff.includes("\n-        a = 1;\n+        a = 2;"));
    assert.ok(!diff.includes("\n-    uint a;"));
});

test("hunk headers count the lines they hold", () => {
    const diff = unifiedDiff(BEFORE, AFTER, "V.sol");
    const header = /@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(diff);
    assert.ok(header !== null);
    const body = diff.split("\n").slice(3);
    assert.equal(Number(header[2]), body.filter((line) => !line.startsWith("+")).length);
    assert.equal(Number(header[4]), body.filter((line) => !line.startsWith("-")).length);
});

test("identical sources produce no diff", () => {
    assert.equal(unifiedDiff(BEFORE, BEFORE, "V.sol"), "");
});

const RESULT: OptimizeResult = {
    reportId: "r2",
    path: "the-dao/contracts/TheDAO.sol",
    original: BEFORE,
    optimized: AFTER,
    changes: [{ title: "Use a custom error — cheaper", why: "Saves gas.", fixes: ["Gas"] }],
    before: { score: 39, grade: "F", counts: { critical: 1, high: 1, medium: 3, low: 3, info: 6 }, deployGas: 440000, parallelScore: 57 },
    after: { score: 79, grade: "B", counts: { critical: 0, high: 0, medium: 3, low: 2, info: 6 }, deployGas: 430000, parallelScore: 80 },
    lines: { added: 2, removed: 1 },
    improved: true,
    free: false,
};

test("the document carries the scores, the changes, the diff and both sources", () => {
    const markdown = optimizationToMarkdown(RESULT, { before: "https://x/report/r1", after: "https://x/report/r2" });
    assert.match(markdown, /\| Score \| 39 \(F\) \| 79 \(B\) \| \+40 \|/);
    assert.match(markdown, /\| Critical \| 1 \| 0 \| -1 \|/);
    assert.match(markdown, /\| Deploy gas \| 440,000 \| 430,000 \| -10,000 \|/);
    assert.ok(markdown.includes("## Original contract") && markdown.includes("        a = 1;"));
    assert.ok(markdown.includes("## Optimized contract") && markdown.includes("        a = 2;"));
    assert.ok(markdown.includes("```diff"));
    assert.ok(markdown.includes("Report after: https://x/report/r2"));
    assert.ok(!markdown.includes("—"));
});
