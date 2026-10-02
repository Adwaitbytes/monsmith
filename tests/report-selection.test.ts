/**
 * The contract chooser's list.
 *
 * It must offer what the server would audit and nothing else: a test file or an
 * interface in the list is a checkbox that silently does nothing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { auditCandidates, defaultSelection, estimateSeconds } from "../lib/report/selection.ts";

const FILES: Record<string, string> = {
    "contracts/Vault.sol": "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\nabstract contract Base {}\ncontract Vault is Base {}\n",
    "contracts/Token.sol": "pragma solidity ^0.8.24;\ncontract Token {}\n",
    "contracts/interfaces/IVault.sol": "pragma solidity ^0.8.24;\ninterface IVault { function f() external; }\n",
    "test/Vault.t.sol": "pragma solidity ^0.8.24;\ncontract VaultTest {}\n",
    "contracts/lib/Math.sol": "pragma solidity ^0.8.24;\nlibrary Math {}\n",
    "README.md": "# not solidity",
};

test("only files the server would audit are offered, named by their main contract", () => {
    const candidates = auditCandidates(FILES);
    assert.deepEqual(
        candidates.map((candidate) => [candidate.path, candidate.name]),
        [
            ["contracts/Token.sol", "Token"],
            ["contracts/Vault.sol", "Vault"],
        ],
    );
});

test("a contract named in a comment does not count as a declaration", () => {
    assert.equal(auditCandidates({ "a/X.sol": "// contract Fake {}\nlibrary L {}\n" }).length, 0);
});

test("the open file alone is ticked when it can be audited", () => {
    const candidates = auditCandidates(FILES);
    assert.deepEqual(defaultSelection(candidates, "contracts/Vault.sol"), ["contracts/Vault.sol"]);
});

test("without an auditable open file, everything up to the cap is ticked", () => {
    const candidates = auditCandidates(FILES);
    assert.deepEqual(defaultSelection(candidates, "README.md"), ["contracts/Token.sol", "contracts/Vault.sol"]);
    assert.deepEqual(defaultSelection(candidates, null, 1), ["contracts/Token.sol"]);
});

test("the estimate grows with the number of contracts", () => {
    assert.equal(estimateSeconds(0), 0);
    assert.ok(estimateSeconds(3) > estimateSeconds(1));
});
