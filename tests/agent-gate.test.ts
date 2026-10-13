/**
 * Two wallets, two jobs, shown as a flip.
 *
 * The developer's wallet registers the agent and deploys the gate. While it
 * holds the ERC-8004 identity it is the agent, and the server wallet is locked
 * out. Once the identity moves to the server wallet the roles swap: the
 * developer is locked out of the gate they deployed, because whoever owns the
 * identity is the agent. Run on the same local EVM the gas profiler uses.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { createEVM, type EVM } from "@ethereumjs/evm";
import { createAddressFromString, hexToBytes, type Address } from "@ethereumjs/util";
import { decodeErrorResult, encodeDeployData, encodeFunctionData, getAddress, type Abi, type Hex } from "viem";

const solc = createRequire(import.meta.url)("solc") as { compile(input: string): string };

interface Artifact {
    abi: Abi;
    bytecode: Hex;
}

function compile(): Record<string, Artifact> {
    // The contracts pin 0.8.24 for deployment; the bundled compiler is newer and compiles the same code.
    const read = (path: string) => readFileSync(path, "utf8").replace("pragma solidity 0.8.24;", "pragma solidity ^0.8.24;");
    const output = JSON.parse(
        solc.compile(
            JSON.stringify({
                language: "Solidity",
                sources: {
                    "AgentGate.sol": { content: read("contracts/examples/AgentGate.sol") },
                    "MockAgentIdentity.sol": { content: read("contracts/attest/mocks/MockAgentIdentity.sol") },
                },
                settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
            }),
        ),
    ) as { contracts: Record<string, Record<string, { abi: Abi; evm: { bytecode: { object: string } } }>>; errors?: Array<{ severity: string; message: string }> };
    const errors = (output.errors ?? []).filter((error) => error.severity === "error");
    assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
    const artifact = (file: string, name: string): Artifact => ({
        abi: output.contracts[file][name].abi,
        bytecode: `0x${output.contracts[file][name].evm.bytecode.object}`,
    });
    return { gate: artifact("AgentGate.sol", "AgentGate"), identity: artifact("MockAgentIdentity.sol", "MockAgentIdentity") };
}

const DEVELOPER = createAddressFromString("0x00000000000000000000000000000000000d0e01");
const SERVER_WALLET = createAddressFromString("0x00000000000000000000000000000000000d0e02");

async function deploy(evm: EVM, artifact: Artifact, args: readonly unknown[] = []): Promise<Address> {
    const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args });
    const result = await evm.runCall({ caller: DEVELOPER, origin: DEVELOPER, data: hexToBytes(data), gasLimit: 10_000_000n });
    assert.equal(result.execResult.exceptionError, undefined);
    assert.ok(result.createdAddress !== undefined);
    return result.createdAddress;
}

async function call(evm: EVM, from: Address, to: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) {
    const data = encodeFunctionData({ abi, functionName, args });
    const result = await evm.runCall({ caller: from, origin: from, to, data: hexToBytes(data), gasLimit: 1_000_000n });
    const reverted = result.execResult.exceptionError !== undefined;
    return {
        ok: !reverted,
        error: reverted ? decodeErrorResult({ abi, data: `0x${Buffer.from(result.execResult.returnValue).toString("hex")}` }) : null,
    };
}

async function setup() {
    const { gate, identity } = compile();
    const evm = await createEVM();
    const registry = await deploy(evm, identity);
    assert.ok((await call(evm, DEVELOPER, registry, identity.abi, "register")).ok);
    const gateAddress = await deploy(evm, gate, [registry.toString(), 1n]);
    return { evm, registry, gateAddress, gate, identity };
}

test("the identity's holder can act and the server wallet is locked out", async () => {
    const { evm, gateAddress, gate } = await setup();
    assert.equal((await call(evm, DEVELOPER, gateAddress, gate.abi, "act")).ok, true);
    const locked = await call(evm, SERVER_WALLET, gateAddress, gate.abi, "act");
    assert.equal(locked.ok, false);
    assert.equal(locked.error?.errorName, "NotTheAgent");
    assert.deepEqual(locked.error?.args, [getAddress(SERVER_WALLET.toString()), getAddress(DEVELOPER.toString())]);
});

test("moving the identity flips who can act, and locks the developer out of their own gate", async () => {
    const { evm, registry, gateAddress, gate, identity } = await setup();
    assert.ok((await call(evm, DEVELOPER, registry, identity.abi, "transfer", [1n, SERVER_WALLET.toString()])).ok);
    assert.equal((await call(evm, SERVER_WALLET, gateAddress, gate.abi, "act")).ok, true);
    const locked = await call(evm, DEVELOPER, gateAddress, gate.abi, "act");
    assert.equal(locked.ok, false);
    assert.equal(locked.error?.errorName, "NotTheAgent");
    assert.deepEqual(locked.error?.args, [getAddress(DEVELOPER.toString()), getAddress(SERVER_WALLET.toString())]);
});
