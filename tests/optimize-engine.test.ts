/**
 * The optimizer's edit protocol.
 *
 * The property everything else leans on: an edit changes exactly the text it
 * quotes, once, or it changes nothing. A model that misquotes a line must not
 * be able to alter some other part of a contract people will deploy.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { applyEdits, buildOptimizePrompt, diffLines, lineDelta, parseEdits, pragmaOf } from "../lib/optimize/engine.ts";

const SOURCE = `pragma solidity ^0.8.24;
contract Vault {
    mapping(address => uint256) public balances;
    function withdraw(uint256 amount) external {
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok);
        balances[msg.sender] -= amount;
    }
}
`;

const REPLY = `Here are the edits.
<edit title="Update the balance before sending" fixes="f1, f2">
<find>
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok);
        balances[msg.sender] -= amount;
</find>
<replace>
        balances[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok);
</replace>
<why>Effects before interactions, so a reentrant call sees the reduced balance.</why>
</edit>`;

test("edits are parsed with their title, the findings they fix, and their reason", () => {
    const [edit] = parseEdits(REPLY);
    assert.equal(edit.title, "Update the balance before sending");
    assert.deepEqual(edit.fixes, ["f1", "f2"]);
    assert.match(edit.why, /Effects before interactions/);
    assert.ok(edit.find.startsWith("        (bool ok"));
});

test("an edit applies to the one place it quotes and nowhere else", () => {
    const result = applyEdits(SOURCE, parseEdits(REPLY));
    assert.equal(result.applied.length, 1);
    assert.equal(result.rejected.length, 0);
    const lines = result.source.split("\n");
    assert.ok(lines.indexOf("        balances[msg.sender] -= amount;") < lines.indexOf("        require(ok);"));
    assert.ok(result.source.includes("mapping(address => uint256) public balances;"));
});

test("an edit quoting text that is not in the file is rejected, not guessed", () => {
    const result = applyEdits(SOURCE, [{ title: "x", fixes: [], find: "selfdestruct(owner);", replace: "", why: "" }]);
    assert.equal(result.source, SOURCE);
    assert.equal(result.rejected.length, 1);
    assert.match(result.rejected[0].reason, /does not occur/);
});

test("an edit quoting text that occurs twice is rejected as ambiguous", () => {
    const result = applyEdits(SOURCE, [{ title: "x", fixes: [], find: "amount", replace: "value", why: "" }]);
    assert.equal(result.source, SOURCE);
    assert.match(result.rejected[0].reason, /ambiguous/);
});

test("replacement text containing dollar signs is inserted literally", () => {
    const result = applyEdits(SOURCE, [{ title: "x", fixes: [], find: "require(ok);", replace: 'require(ok, "$& $1");', why: "" }]);
    assert.ok(result.source.includes('require(ok, "$& $1");'));
});

test("the prompt pins the pragma and lists findings worst first", () => {
    const prompt = buildOptimizePrompt({
        path: "contracts/Vault.sol",
        contractName: "Vault",
        source: SOURCE,
        pragma: pragmaOf(SOURCE),
        findings: [
            { id: "low1", severity: "low", title: "Floating pragma", source: "security" },
            { id: "crit1", severity: "critical", title: "Reentrancy", source: "security", line: 5 },
        ],
        contendedSlots: ["balances"],
        expensiveFunctions: [{ name: "withdraw", gas: 32000 }],
        imports: [],
    });
    assert.ok(prompt.includes("Keep the pragma exactly as it is (^0.8.24)"));
    assert.ok(prompt.indexOf("[crit1]") < prompt.indexOf("[low1]"));
    assert.ok(prompt.includes("   5 |         (bool ok"));
    assert.ok(!/\n{3,}/.test(prompt));
});

test("line deltas count real additions and removals", () => {
    assert.deepEqual(lineDelta("a\nb\nc", "a\nb\nc"), { added: 0, removed: 0 });
    assert.deepEqual(lineDelta("a\nb\nc", "a\nx\nb\nc"), { added: 1, removed: 0 });
    assert.deepEqual(lineDelta("a\nb\nc", "a\nc"), { added: 0, removed: 1 });
});

test("the diff names exactly the new file's changed lines, 1-indexed", () => {
    assert.deepEqual(diffLines("a\nb\nc\nd", "a\nB\nc\nd").changed, [2]);
    assert.deepEqual(diffLines("a\nb", "a\nx\ny\nb").changed, [2, 3]);
    assert.deepEqual(diffLines("a\nb\nc", "a\nc").changed, []);
    assert.deepEqual(diffLines("same", "same").changed, []);
});

test("a quote with the wrong indentation still lands on its one matching place", () => {
    const edit = { title: "x", fixes: [], why: "", find: "(bool ok, ) = msg.sender.call{value: amount}(\"\");\nrequire(ok);", replace: "        _send(amount);" };
    const result = applyEdits(SOURCE, [edit]);
    assert.equal(result.rejected.length, 0);
    assert.ok(result.source.includes("        _send(amount);\n        balances[msg.sender] -= amount;"));
    assert.ok(!result.source.includes("require(ok);"));
});

test("line-number prefixes copied from the listing are ignored", () => {
    const edit = { title: "x", fixes: [], why: "", find: "   6 |         require(ok);", replace: "   6 |         require(ok, \"send failed\");" };
    const result = applyEdits(SOURCE, [edit]);
    assert.equal(result.rejected.length, 0);
    assert.ok(result.source.includes('        require(ok, "send failed");'));
});

test("tolerant matching still refuses a quote that fits two places", () => {
    const twice = "a {\n    x = 1;\n}\nb {\n    x = 1;\n}\n";
    const result = applyEdits(twice, [{ title: "x", fixes: [], why: "", find: "x = 1;", replace: "x = 2;" }]);
    assert.equal(result.source, twice);
    assert.match(result.rejected[0].reason, /ambiguous/);
});
