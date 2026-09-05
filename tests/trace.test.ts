/**
 * End-to-end checks on the tracer and the repricer, against contracts whose
 * cost can be worked out by hand from the two published gas schedules.
 *
 * These are the assertions that make a Chain Fit number defensible: not "the
 * tool ran", but "the tool produced the figure the specification implies".
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { encodeFunctionData, type Abi } from "viem";

import { compileContract } from "../lib/solc.ts";
import { getChain } from "../lib/chainfit/chains.ts";
import { monadDelta, repriceTrace } from "../lib/chainfit/reprice.ts";
import {
    createTracingEvm,
    toBytes,
    traceCall,
    traceDeployment,
} from "../lib/chainfit/trace.ts";
import { intrinsicGas } from "../lib/chainfit/schedules.ts";

const PACKED = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Packed {
    uint256 private a;
    uint256 private b;
    uint256 private c;
    uint256 private d;

    // Four fresh slots, all inside page 0.
    function setAll() external {
        a = 1; b = 2; c = 3; d = 4;
    }

    // Four reads, all inside page 0.
    function readAll() external view returns (uint256) {
        return a + b + c + d;
    }

    // One slot per page: slot 0 and slot 128 are on different pages.
    function spread() external {
        assembly {
            sstore(0, 1)
            sstore(128, 1)
        }
    }
}
`;

const CALLER_HEAVY = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITarget { function ping() external view returns (uint256); }

contract CallerHeavy {
    // Five distinct cold addresses, so the account access reprice is visible.
    function fanOut(address[] calldata targets) external view returns (uint256 total) {
        for (uint256 i = 0; i < targets.length; i++) {
            total += targets[i].balance;
        }
    }
}
`;

async function deploy(source: string) {
    const compiled = compileContract(source, [
        "abi",
        "evm.bytecode",
        "evm.deployedBytecode",
    ]);
    const bytecode = compiled.contract.evm?.bytecode?.object;
    assert.ok(bytecode, "expected bytecode");
    const initCode = toBytes(bytecode);
    const evm = await createTracingEvm();
    const deployment = await traceDeployment(evm, initCode, intrinsicGas(initCode, true));
    assert.equal(deployment.status, "ok", "deployment should succeed");
    assert.ok(deployment.address, "deployment should yield an address");
    return { evm, deployment, abi: compiled.contract.abi };
}

/** Selectors are derived from the ABI so a renamed function fails loudly. */
function encode(abi: Abi, functionName: string, args: unknown[] = []): Uint8Array {
    return toBytes(
        encodeFunctionData({ abi, functionName, args } as Parameters<typeof encodeFunctionData>[0]),
    );
}

test("deployment is traced and reports both size limits", async () => {
    const { deployment } = await deploy(PACKED);
    assert.ok(deployment.runtimeCodeSize > 0);
    assert.ok(deployment.initCodeSize > deployment.runtimeCodeSize);
    assert.ok(deployment.ethereumExecutionGas > 0);
    assert.equal(deployment.storageAccesses.length, 0, "no storage writes in this constructor");
});

test("four fresh slots in one page cost 9,200 gas less on monad", async () => {
    const { evm, deployment, abi } = await deploy(PACKED);
    const calldata = encode(abi, "setAll");
    const trace = await traceCall(
        evm,
        deployment.address as string,
        calldata,
        intrinsicGas(calldata, false),
    );

    assert.equal(trace.status, "ok");
    assert.equal(trace.storageAccesses.length, 4);
    assert.ok(trace.storageAccesses.every((access) => access.createsSlot));

    // Ethereum: 4 x (2100 cold + 20000 set)      = 88,400
    // Monad:    (100+8000+2800+17000) + 3x(100+17000) = 79,200
    const delta = monadDelta(trace);
    assert.equal(delta.storage, 79_200 - 88_400);
    assert.equal(trace.observedStorageGas, 88_400, "ethereum side should be measured, not modelled");

    const monad = repriceTrace(trace, getChain("monad"));
    const ethereum = repriceTrace(trace, getChain("ethereum"));
    assert.equal(monad.storageBasis, "measured");
    assert.equal(monad.executionGas, ethereum.executionGas + delta.total);
    assert.ok(monad.executionGas < ethereum.executionGas);
});

test("four reads in one page collapse to a single page charge", async () => {
    const { evm, deployment, abi } = await deploy(PACKED);
    const calldata = encode(abi, "readAll");
    const trace = await traceCall(
        evm,
        deployment.address as string,
        calldata,
        intrinsicGas(calldata, false),
    );

    assert.equal(trace.status, "ok");
    assert.equal(trace.storageAccesses.length, 4);
    // Ethereum: 4 x 2100 cold = 8,400. Monad: 8,100 + 3 x 100 = 8,400.
    assert.equal(trace.observedStorageGas, 8_400);
    assert.equal(monadDelta(trace).storage, 0, "four slots is exactly the break-even point");
});

test("slots on separate pages cost more on monad", async () => {
    const { evm, deployment, abi } = await deploy(PACKED);
    const calldata = encode(abi, "spread");
    const trace = await traceCall(
        evm,
        deployment.address as string,
        calldata,
        intrinsicGas(calldata, false),
    );

    assert.equal(trace.status, "ok");
    assert.equal(trace.storageAccesses.length, 2);
    // Ethereum: 2 x 22,100 = 44,200. Monad: 2 x 27,900 = 55,800.
    assert.equal(trace.observedStorageGas, 44_200);
    assert.equal(monadDelta(trace).storage, 55_800 - 44_200);
});

test("cold account access is repriced at 7,500 gas per distinct address", async () => {
    const { evm, deployment, abi } = await deploy(CALLER_HEAVY);
    const targets = Array.from(
        { length: 5 },
        (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}` as `0x${string}`,
    );
    const calldata = encode(abi, "fanOut", [targets]);
    const trace = await traceCall(
        evm,
        deployment.address as string,
        calldata,
        intrinsicGas(calldata, false),
    );

    assert.equal(trace.status, "ok");
    assert.equal(trace.accountAccesses.length, 5, "five BALANCE opcodes");
    assert.equal(monadDelta(trace).accountAccess, 5 * (10_100 - 2_600));
});

test("a reverting call is reported as reverted rather than silently counted", async () => {
    const source = `
        // SPDX-License-Identifier: MIT
        pragma solidity ^0.8.24;
        contract Guarded {
            function boom() external pure { revert("nope"); }
        }
    `;
    const { evm, deployment, abi } = await deploy(source);
    const calldata = encode(abi, "boom");
    const trace = await traceCall(
        evm,
        deployment.address as string,
        calldata,
        intrinsicGas(calldata, false),
    );
    assert.equal(trace.status, "reverted");
    assert.equal(trace.revertReason, "nope");
});

test("each traced call starts at a transaction boundary, not warm from deployment", async () => {
    // The constructor writes slot 0, so without a journal reset the SLOAD below
    // would be charged 100 gas as an already-warm slot instead of 2,100, and the
    // SSTORE would be treated as an already-dirty slot at 100 instead of 2,900.
    const source = `
        // SPDX-License-Identifier: MIT
        pragma solidity ^0.8.24;
        contract Warm {
            uint256 private a;
            constructor() { a = 7; }
            function bump() external { a = a + 1; }
        }
    `;
    const { evm, deployment, abi } = await deploy(source);
    const calldata = encode(abi, "bump");
    const trace = await traceCall(
        evm,
        deployment.address as string,
        calldata,
        intrinsicGas(calldata, false),
    );

    assert.equal(trace.status, "ok");
    assert.equal(trace.storageAccesses.length, 2, "one read and one write of slot 0");
    // Cold SLOAD 2,100 plus a warm non-zero-to-non-zero SSTORE 2,900.
    assert.equal(trace.observedStorageGas, 5_000);
    // Monad: 100 + 8000 page load, then 100 + 2800 page write. No state growth,
    // because the slot was already non-zero.
    assert.equal(monadDelta(trace).storage, 11_000 - 5_000);
});

test("two calls in a row are measured identically", async () => {
    const source = `
        // SPDX-License-Identifier: MIT
        pragma solidity ^0.8.24;
        contract Counter {
            uint256 private n;
            function inc() external { n = n + 1; }
        }
    `;
    const { evm, deployment, abi } = await deploy(source);
    const calldata = encode(abi, "inc");
    const first = await traceCall(
        evm,
        deployment.address as string,
        calldata,
        intrinsicGas(calldata, false),
    );
    const second = await traceCall(
        evm,
        deployment.address as string,
        calldata,
        intrinsicGas(calldata, false),
    );

    assert.equal(first.ethereumExecutionGas, second.ethereumExecutionGas);
    assert.equal(first.observedStorageGas, second.observedStorageGas);
    assert.deepEqual(monadDelta(first), monadDelta(second));
});
