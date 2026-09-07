/**
 * Library linking.
 *
 * A library with public or external functions is its own contract on chain, and
 * every caller holds a DELEGATECALL to an address solc cannot know, so it
 * leaves a 20-byte hole and records where. Deploying that bytecode unchanged
 * does not fail: it puts `__$<hash>$__` on chain where those bytes are executed
 * as instructions. The studio used to do exactly that, silently.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    deploymentOrder,
    hasUnlinkedPlaceholder,
    librariesRequired,
    linkBytecode,
} from "../lib/link.ts";
import { compileForDeploy } from "../lib/solc/compile.ts";

const USES_LIBRARY = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
library BigMath { function mul(uint256 a, uint256 b) public pure returns (uint256) { return a * b; } }
contract UsesLib { function f(uint256 a) external pure returns (uint256) { return BigMath.mul(a, 2); } }`;

const ADDRESS = "0x4b52e6D398751c5A218070403008F4879c424578";

test("a contract calling a public library compiles to bytecode with a hole in it", async () => {
    const artifact = await compileForDeploy(USES_LIBRARY);

    assert.ok(hasUnlinkedPlaceholder(artifact.bytecode), "this is what used to reach the chain");
    assert.equal(artifact.libraries.length, 1);
    assert.equal(artifact.libraries[0].name, "BigMath");
    assert.ok(artifact.libraries[0].bytecode.length > 0, "the library has to be deployable itself");
});

test("linking fills the hole with the address and nothing else moves", async () => {
    const artifact = await compileForDeploy(USES_LIBRARY);
    const linked = linkBytecode(artifact.bytecode, artifact.linkReferences, {
        [artifact.libraries[0].qualified]: ADDRESS,
    });

    assert.equal(linked.length, artifact.bytecode.length, "linking must not resize the code");
    assert.ok(!hasUnlinkedPlaceholder(linked));
    assert.ok(linked.includes(ADDRESS.slice(2).toLowerCase()), "the address is written in");
});

test("a contract with no libraries is untouched", async () => {
    const artifact = await compileForDeploy(
        "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\ncontract Plain { uint256 public x; }",
    );

    assert.deepEqual(artifact.libraries, []);
    assert.ok(!hasUnlinkedPlaceholder(artifact.bytecode));
});

test("a missing address is refused rather than deployed half-linked", () => {
    const references = { "a.sol": { Lib: [{ start: 4, length: 20 }] } };
    assert.throws(() => linkBytecode(`0x${"00".repeat(40)}`, references, {}), /No address to link/);
    assert.throws(
        () => linkBytecode(`0x${"00".repeat(40)}`, references, { Lib: "not-an-address" }),
        /not an address/,
    );
});

test("libraries deploy in dependency order", () => {
    const order = deploymentOrder({
        "a.sol:Top": { linkReferences: { "b.sol": { Base: [{ start: 0, length: 20 }] } } },
        "b.sol:Base": {},
    });
    assert.deepEqual(order, ["b.sol:Base", "a.sol:Top"]);
});

test("a dependency cycle is reported instead of looped on", () => {
    assert.throws(
        () =>
            deploymentOrder({
                "a.sol:A": { linkReferences: { "b.sol": { B: [{ start: 0, length: 20 }] } } },
                "b.sol:B": { linkReferences: { "a.sol": { A: [{ start: 0, length: 20 }] } } },
            }),
        /cycle/,
    );
});

test("linkReferences flatten to one entry per library", () => {
    const found = librariesRequired({
        "contracts/Math.sol": { BigMath: [{ start: 10, length: 20 }, { start: 90, length: 20 }] },
    });

    assert.equal(found.length, 1);
    assert.equal(found[0].qualified, "contracts/Math.sol:BigMath");
    assert.equal(found[0].positions.length, 2, "both call sites need patching");
});
