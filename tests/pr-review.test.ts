/**
 * The pull request review's bookkeeping.
 *
 * The number this feature is judged by is fixes merged off its comments, so the
 * properties pinned here are the ones that keep that number honest: a finding
 * that moved lines is not a fix, a finding in a file nobody re-audited is not a
 * fix, an unsigned delivery does nothing, and the comment says what changed
 * since the last push before anything else.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { COMMENT_MARKER, renderComment, type CommentInput } from "../lib/prReview/comment.ts";
import {
    annotationsFor,
    compareReviews,
    conclusionFor,
    findingKey,
    trackedFindings,
    type TrackedFinding,
} from "../lib/prReview/tracking.ts";
import { parseEvent, shouldReview, verifySignature } from "../lib/prReview/webhook.ts";
import type { ContractReport, Finding, RepoReport } from "../lib/report/types.ts";

function contract(path: string, findings: Finding[], score = 50): ContractReport {
    return {
        id: path,
        path,
        name: "Vault",
        health: { score, grade: "D", headline: "" },
        findings,
        counts: {
            critical: findings.filter((f) => f.severity === "critical").length,
            high: findings.filter((f) => f.severity === "high").length,
            medium: findings.filter((f) => f.severity === "medium").length,
            low: findings.filter((f) => f.severity === "low").length,
            info: findings.filter((f) => f.severity === "info").length,
        },
        sections: {
            security: { status: "pending" },
            parallel: { status: "pending" },
            gas: { status: "pending" },
            chainfit: { status: "pending" },
        },
    };
}

function report(contracts: ContractReport[]): RepoReport {
    return {
        reportId: "r1",
        createdAt: "2026-10-14T00:00:00.000Z",
        origin: { kind: "github", owner: "acme", repo: "vault", ref: "a".repeat(40), private: false },
        health: null,
        counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        contracts,
        skipped: [],
        notes: [],
        redacted: false,
    };
}

const reentrancy: Finding = { id: "1", severity: "critical", title: "Reentrancy in withdraw", source: "ai", line: 12, description: "The balance is updated after the call.", fix: "Update the balance first." };
const gas: Finding = { id: "2", severity: "low", title: "Cache array length", source: "gas", line: 30 };
const pragma: Finding = { id: "3", severity: "info", title: "Floating pragma", source: "security", line: 1 };
const owner: Finding = { id: "4", severity: "high", title: "Missing access control on setFee", source: "security", line: 40 };

test("only security findings above info are tracked from push to push", () => {
    const tracked = trackedFindings(report([contract("src/Vault.sol", [gas, pragma, owner, reentrancy])]));
    assert.deepEqual(tracked.map((finding) => finding.title), ["Reentrancy in withdraw", "Missing access control on setFee"]);
});

test("a finding keyed by file, engine and title survives being moved to another line", () => {
    assert.equal(findingKey("src/Vault.sol", "ai", "Reentrancy in `withdraw`"), findingKey("src/Vault.sol", "ai", "reentrancy in withdraw"));
    const before = trackedFindings(report([contract("src/Vault.sol", [reentrancy])]));
    const after = trackedFindings(report([contract("src/Vault.sol", [{ ...reentrancy, line: 15 }])]));
    const delta = compareReviews(before, after, new Set(["src/Vault.sol"]));
    assert.equal(delta.fixed.length, 0);
    assert.equal(delta.introduced.length, 0);
});

test("a finding gone from a re-audited contract counts as fixed", () => {
    const before = trackedFindings(report([contract("src/Vault.sol", [reentrancy, owner])]));
    const after = trackedFindings(report([contract("src/Vault.sol", [owner])]));
    const delta = compareReviews(before, after, new Set(["src/Vault.sol"]));
    assert.deepEqual(delta.fixed.map((finding) => finding.title), ["Reentrancy in withdraw"]);
    assert.deepEqual(delta.open.map((finding) => finding.title), ["Missing access control on setFee"]);
});

test("a finding in a contract this run did not audit is not a fix", () => {
    const before = trackedFindings(report([contract("src/Vault.sol", [reentrancy]), contract("src/Fee.sol", [owner])]));
    const after = trackedFindings(report([contract("src/Vault.sol", [reentrancy])]));
    const delta = compareReviews(before, after, new Set(["src/Vault.sol"]));
    assert.equal(delta.fixed.length, 0);
});

test("a new finding in a contract the pull request already had is reported as new", () => {
    const before = trackedFindings(report([contract("src/Vault.sol", [owner])]));
    const after = trackedFindings(report([contract("src/Vault.sol", [owner, reentrancy])]));
    const delta = compareReviews(before, after, new Set(["src/Vault.sol"]));
    assert.deepEqual(delta.introduced.map((finding) => finding.title), ["Reentrancy in withdraw"]);
});

test("the first review reports what is open and claims no fixes", () => {
    const after = trackedFindings(report([contract("src/Vault.sol", [reentrancy])]));
    const delta = compareReviews(null, after, new Set(["src/Vault.sol"]));
    assert.equal(delta.firstReview, true);
    assert.equal(delta.fixed.length, 0);
    assert.equal(delta.open.length, 1);
});

test("the check fails while a critical or high is open and passes otherwise", () => {
    const open = (severity: TrackedFinding["severity"]): TrackedFinding[] => [{ key: "k", path: "a.sol", severity, title: "t", line: null, source: "ai" }];
    assert.equal(conclusionFor(open("high")), "failure");
    assert.equal(conclusionFor(open("medium")), "success");
    assert.equal(conclusionFor([]), "success");
});

test("annotations sit on their line, worst first, and skip findings with no line", () => {
    const annotations = annotationsFor(report([contract("src/Vault.sol", [owner, { ...reentrancy }, { ...owner, title: "No line", line: undefined }])]));
    assert.deepEqual(annotations.map((a) => [a.start_line, a.annotation_level]), [[40, "failure"], [12, "failure"]]);
    assert.match(annotations.find((a) => a.start_line === 12)?.message ?? "", /Fix: Update the balance first/);
});

function commentInput(overrides: Partial<CommentInput> = {}): CommentInput {
    const r = report([contract("src/Vault.sol", [owner], 72)]);
    const before = trackedFindings(report([contract("src/Vault.sol", [reentrancy, owner], 39)]));
    return {
        report: r,
        reportUrl: "https://www.monsmith.com/report/r1",
        headSha: "b".repeat(40),
        blobUrl: (path, line) => `https://github.com/acme/vault/blob/sha/${path}${line === null ? "" : `#L${line}`}`,
        delta: compareReviews(before, trackedFindings(r), new Set(["src/Vault.sol"])),
        firstScores: { "src/Vault.sol": 39 },
        fixedSoFar: 1,
        notAudited: [{ path: "test/Vault.t.sol", reason: "test or script" }],
        siteUrl: "https://www.monsmith.com",
        ...overrides,
    };
}

test("the comment leads with what this push fixed and shows the score movement", () => {
    const body = renderComment(commentInput());
    assert.ok(body.startsWith(COMMENT_MARKER));
    assert.match(body, /### Monsmith · This push fixed 1 finding/);
    assert.match(body, /~~Reentrancy in withdraw~~/);
    assert.match(body, /\*\*72\*\* D \(39 at the first review\)/);
    assert.match(body, /\[`src\/Vault.sol:40`\]\(https:\/\/github.com\/acme\/vault\/blob\/sha\/src\/Vault.sol#L40\)/);
    assert.match(body, /Not audited: `test\/Vault.t.sol` \(test or script\)/);
    assert.ok(body.length < 65_536);
});

test("text from the model cannot open HTML in the comment", () => {
    const evil: Finding = { ...owner, title: "<img src=x onerror=alert(1)>" };
    const r = report([contract("src/Vault.sol", [evil])]);
    const body = renderComment(commentInput({ report: r, delta: compareReviews(null, trackedFindings(r), new Set(["src/Vault.sol"])) }));
    assert.ok(!body.includes("<img"));
});

test("after a merge the comment lists what was attested and what was not", () => {
    const body = renderComment(
        commentInput({
            merge: {
                attested: [{ path: "src/Vault.sol", txUrl: "https://monadvision.com/tx/0xabc" }],
                notAttested: [{ path: "src/Fee.sol", reason: "the merged code is not the code that was reviewed" }],
            },
        }),
    );
    assert.match(body, /### Monsmith · Merged with 1 open finding/);
    assert.match(body, /\*\*Attested on Monad\.\*\*/);
    assert.match(body, /`src\/Fee.sol` was not attested/);
});

const SECRET = "test-secret";
function sign(body: string): string {
    return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

test("a delivery is accepted only with GitHub's signature over the exact bytes", () => {
    const body = JSON.stringify({ action: "opened" });
    assert.equal(verifySignature(SECRET, body, sign(body)), true);
    assert.equal(verifySignature(SECRET, `${body} `, sign(body)), false);
    assert.equal(verifySignature(SECRET, body, null), false);
    assert.equal(verifySignature("", body, sign(body)), false);
    assert.equal(verifySignature(SECRET, body, "sha256=00"), false);
});

const PULL_PAYLOAD = {
    action: "synchronize",
    installation: { id: 42 },
    repository: { id: 7, name: "vault", full_name: "acme/vault", private: true, default_branch: "main", owner: { login: "acme" } },
    pull_request: {
        number: 3,
        title: "Fix withdraw",
        user: { login: "dev" },
        draft: false,
        merged: false,
        merge_commit_sha: null,
        head: { sha: "c".repeat(40) },
        base: { ref: "main" },
    },
};

test("a pull request delivery is read into the fields the review needs", () => {
    const event = parseEvent("pull_request", PULL_PAYLOAD);
    assert.equal(event.kind, "pull_request");
    if (event.kind !== "pull_request") return;
    assert.equal(event.installationId, 42);
    assert.equal(event.repo.fullName, "acme/vault");
    assert.equal(event.repo.private, true);
    assert.equal(event.pull.headSha, "c".repeat(40));
    assert.equal(shouldReview(event), true);
});

test("drafts, unknown actions and malformed shas are not reviewed", () => {
    const draft = parseEvent("pull_request", { ...PULL_PAYLOAD, pull_request: { ...PULL_PAYLOAD.pull_request, draft: true } });
    assert.equal(draft.kind === "pull_request" && shouldReview(draft), false);
    assert.equal(parseEvent("pull_request", { ...PULL_PAYLOAD, action: "labeled" }).kind, "ignored");
    assert.equal(parseEvent("pull_request", { ...PULL_PAYLOAD, pull_request: { ...PULL_PAYLOAD.pull_request, head: { sha: "main" } } }).kind, "ignored");
    assert.equal(parseEvent("push", PULL_PAYLOAD).kind, "ignored");
});

test("installation events carry the account so retention can be measured per team", () => {
    const event = parseEvent("installation", { action: "deleted", installation: { id: 9, account: { login: "acme", type: "Organization" } } });
    assert.deepEqual(event, { kind: "installation", action: "deleted", installationId: 9, account: "acme", accountType: "Organization" });
});

test("a chosen contract is audited even when ten bigger ones would fill the cap, and unchanged code is reused", async () => {
    const { buildRepoReport } = await import("../lib/report/build.ts");
    const { sourceHash } = await import("../lib/attest/hash.ts");
    const big = (n: number) =>
        `pragma solidity ^0.8.24;\ncontract Big${n} {\n${Array.from({ length: 12 }, (_, i) => `    function f${i}() external {}`).join("\n")}\n}\n`;
    const small = "pragma solidity ^0.8.24;\ncontract Small {\n    function only() external {}\n}\n";
    const files: Record<string, string> = { "src/Small.sol": small };
    for (let n = 0; n < 11; n += 1) files[`src/Big${n}.sol`] = big(n);

    const earlier = { ...contract("src/Small.sol", [owner], 64), sourceHash: sourceHash(small) };
    let done: RepoReport | null = null;
    for await (const step of buildRepoReport({
        files,
        origin: { kind: "workspace" },
        cap: 10,
        only: ["src/Small.sol"],
        reuse: { "src/Small.sol": earlier },
    })) {
        if (step.type === "complete") done = step.report;
    }
    assert.ok(done !== null);
    assert.deepEqual(done.contracts.map((c) => c.path), ["src/Small.sol"]);
    assert.equal(done.contracts[0].health?.score, 64);
    assert.deepEqual(done.contracts[0].findings, [owner]);
});
