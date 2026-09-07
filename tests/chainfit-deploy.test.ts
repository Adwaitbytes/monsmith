/**
 * Measuring a deployment that actually happened.
 *
 * A reverted constructor still burns gas, and the tracer still reports it. That
 * number is the cost of failing, not the cost of deploying, and Chain Fit
 * printed it as "deploying X costs $Y". A whole class of contract hits this:
 * anything summing an array and requiring msg.value to match reverts for every
 * non-empty array, since a traced deployment sends no value. An escrow, a
 * vesting schedule and a payment splitter are all shaped that way.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeDeployData } from "viem";

import { constructorAttempts } from "../lib/chainfit/args.ts";
import { compileForDeploy } from "../lib/solc/compile.ts";
import { createTracingEvm, toBytes, traceDeployment } from "../lib/chainfit/trace.ts";
import { intrinsicGas } from "../lib/chainfit/schedules.ts";

const ESCROW = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract MilestoneEscrow {
    address public immutable client;
    address payable public immutable freelancer;
    uint256[] public milestones;
    error InvalidDepositAmount();
    constructor(address payable f, uint256[] memory m) payable {
        client = msg.sender; freelancer = f; milestones = m;
        uint256 t = 0;
        for (uint i = 0; i < m.length; i++) { t += m[i]; }
        if (msg.value != t) revert InvalidDepositAmount();
    }
}`;

const PLAIN = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Plain { uint256 public x; constructor(uint256 v) { x = v; } }`;

async function attempt(source: string, args: unknown[]) {
    const artifact = await compileForDeploy(source);
    const encoded = encodeDeployData({
        abi: artifact.abi,
        bytecode: `0x${artifact.bytecode}`,
        args,
    } as never);
    const code = toBytes(encoded);
    return traceDeployment(await createTracingEvm(), code, intrinsicGas(code, true));
}

test("the sample arguments alone leave this constructor reverting", async () => {
    const artifact = await compileForDeploy(ESCROW);
    const attempts = constructorAttempts(artifact.abi);

    const first = await attempt(ESCROW, attempts[0].args);
    assert.equal(first.status, "reverted", "this is the case that produced a wrong headline");
    assert.equal(first.runtimeCodeSize, 0, "nothing was deployed, so nothing can be priced");
});

test("emptying the arrays gets the same constructor on chain", async () => {
    const artifact = await compileForDeploy(ESCROW);
    const attempts = constructorAttempts(artifact.abi);
    assert.ok(attempts.length > 1, "an array argument has to produce a second attempt");

    const fallback = await attempt(ESCROW, attempts[1].args);
    assert.equal(fallback.status, "ok");
    assert.ok(fallback.runtimeCodeSize > 0, "the runtime code is on chain, so gas is real");
});

test("a deployment that fails costs less than one that works", async () => {
    const artifact = await compileForDeploy(ESCROW);
    const attempts = constructorAttempts(artifact.abi);

    const failed = await attempt(ESCROW, attempts[0].args);
    const worked = await attempt(ESCROW, attempts[1].args);

    // Precisely why the reverted figure cannot stand in for the real one: it
    // never paid to put the runtime code on chain, which is most of the cost.
    assert.ok(
        worked.ethereumExecutionGas > failed.ethereumExecutionGas,
        "the failed deployment skipped the code deposit entirely",
    );
});

test("a constructor with no array gets one attempt, not a pointless second", async () => {
    const artifact = await compileForDeploy(PLAIN);
    assert.equal(constructorAttempts(artifact.abi).length, 1);
});

test("a contract with no constructor arguments still yields one attempt", async () => {
    const artifact = await compileForDeploy(
        "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\ncontract N { uint256 public x; }",
    );
    const attempts = constructorAttempts(artifact.abi);
    assert.deepEqual(attempts, [{ label: "no arguments", args: [] }]);
});
