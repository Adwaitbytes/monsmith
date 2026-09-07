/**
 * Explaining a failed transaction.
 *
 * A custom error costs a contract far less gas than a require string, so it is
 * now the normal way to fail, and the chain returns nothing but a four-byte
 * selector for one. The wallet has no ABI and prints "execution reverted"; the
 * studio does have the ABI, so it can say which error was raised.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeErrorResult, type Abi } from "viem";

import { decodeRevert, revertData } from "../lib/revert.ts";

const ABI = [
    { type: "error", name: "InvalidDepositAmount", inputs: [] },
    {
        type: "error",
        name: "InvalidResolutionShares",
        inputs: [{ name: "expected", type: "uint256" }],
    },
    { type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] },
    { type: "error", name: "Panic", inputs: [{ name: "code", type: "uint256" }] },
] as const satisfies Abi;

test("a custom error is named, not shown as a selector", () => {
    const data = encodeErrorResult({ abi: ABI, errorName: "InvalidDepositAmount" });
    assert.equal(decodeRevert(data, ABI as unknown as Abi), "reverted with InvalidDepositAmount()");
});

test("a custom error's arguments come through at full precision", () => {
    const data = encodeErrorResult({
        abi: ABI,
        errorName: "InvalidResolutionShares",
        args: [300000000000000000n],
    });
    assert.equal(
        decodeRevert(data, ABI as unknown as Abi),
        "reverted with InvalidResolutionShares(300000000000000000)",
    );
});

test("a require string is read back as the string", () => {
    const data = encodeErrorResult({ abi: ABI, errorName: "Error", args: ["Transfer failed"] });
    assert.equal(decodeRevert(data, ABI as unknown as Abi), "reverted: Transfer failed");
});

test("a panic is explained rather than printed as a code", () => {
    const data = encodeErrorResult({ abi: ABI, errorName: "Panic", args: [0x11n] });
    assert.match(decodeRevert(data, ABI as unknown as Abi) ?? "", /overflow/);
});

test("an error from another contract says so instead of guessing", () => {
    const decoded = decodeRevert("0xdeadbeef", ABI as unknown as Abi);
    assert.match(decoded ?? "", /not defined in this contract/);
});

test("nothing to decode yields nothing, so a real message is never replaced", () => {
    assert.equal(decodeRevert(null, ABI as unknown as Abi), null);
    assert.equal(decodeRevert("0x", ABI as unknown as Abi), null);
});

test("the payload is found however the provider nested it", () => {
    const data = encodeErrorResult({ abi: ABI, errorName: "InvalidDepositAmount" });

    assert.equal(revertData({ data }), data);
    assert.equal(revertData({ cause: { cause: { data } } }), data);
    assert.equal(revertData({ cause: { data: { data } } }), data);
    assert.equal(revertData({ message: "boom" }), null);
});

test("a self-referencing error chain terminates", () => {
    const loop: Record<string, unknown> = { message: "boom" };
    loop.cause = loop;
    assert.equal(revertData(loop), null);
});
