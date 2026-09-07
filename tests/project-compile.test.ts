/**
 * Compiling the workspace rather than the open file.
 *
 * A file tree is decorative if the compiler only ever sees one file: Solidity
 * resolves `import "./lib/Ownable.sol"` against a path, so unless the other
 * files are passed under the paths they are imported by, every project split
 * across files fails to build. The first assertion is the old behaviour, kept
 * deliberately, because it is the reason the second one has to exist.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { compileForDeploy } from "../lib/solc/compile.ts";

const OWNABLE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Ownable {
    address public owner;
    constructor() { owner = msg.sender; }
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
}`;

const VAULT = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./lib/Ownable.sol";
contract Vault is Ownable {
    uint256 public total;
    function deposit(uint256 amount) external onlyOwner { total += amount; }
}`;

const SOURCES = { "contracts/Vault.sol": VAULT, "contracts/lib/Ownable.sol": OWNABLE };

test("a contract importing another file cannot compile on its own", async () => {
    await assert.rejects(
        () => compileForDeploy(VAULT),
        /Ownable|not found|Source .* not found/i,
        "if this starts passing, the import is being resolved from somewhere unintended",
    );
});

test("the same contract compiles when the workspace comes with it", async () => {
    const result = await compileForDeploy(VAULT, {
        sources: SOURCES,
        entry: "contracts/Vault.sol",
    });

    assert.ok(result.bytecode.length > 0);
    const names = result.abi.map((entry) => ("name" in entry ? entry.name : "constructor"));
    assert.ok(names.includes("deposit"), "the entry contract's own function");
    assert.ok(names.includes("owner"), "and what it inherited from the imported file");
});

test("the open file decides which contract is built, not its size", async () => {
    // Ownable is the smaller of the two, so "largest bytecode" would pick Vault.
    // Someone with Ownable.sol open means to build Ownable.
    const result = await compileForDeploy(OWNABLE, {
        sources: SOURCES,
        entry: "contracts/lib/Ownable.sol",
    });

    const names = result.abi.map((entry) => ("name" in entry ? entry.name : "constructor"));
    assert.ok(names.includes("owner"));
    assert.ok(!names.includes("deposit"), "Vault is in the project but is not the target");
});

test("unsaved edits to the open file win over the copy in the workspace", async () => {
    // The editor writes on a keystroke, but a compile triggered in the same tick
    // must still build what is on screen rather than the last persisted value.
    const edited = VAULT.replace("function deposit", "function contribute");
    const result = await compileForDeploy(edited, {
        sources: SOURCES,
        entry: "contracts/Vault.sol",
    });

    const names = result.abi.map((entry) => ("name" in entry ? entry.name : "constructor"));
    assert.ok(names.includes("contribute"));
    assert.ok(!names.includes("deposit"));
});
