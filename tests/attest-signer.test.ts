/**
 * Which wallet signs attestations.
 *
 * What matters: the Dynamic MPC wallet is used only when every one of its
 * settings is present, a half-configured Dynamic setup never silently signs
 * with something else, and the raw key is the fallback rather than the default.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { dynamicSettings, signerKind } from "../lib/attest/signer.ts";

const dynamic = {
    DYNAMIC_ENVIRONMENT_ID: "env",
    DYNAMIC_AUTH_TOKEN: "dyn_token",
    DYNAMIC_WALLET_METADATA: "e30=",
    DYNAMIC_SERVER_KEY_SHARES: "W10=",
    DYNAMIC_WALLET_PASSWORD: "secret",
};
const key = { MONSMITH_ATTESTER_KEY: `0x${"11".repeat(32)}` };

test("the Dynamic wallet signs when it is fully configured, even with a raw key present", () => {
    assert.equal(signerKind({ ...dynamic, ...key }), "dynamic");
    assert.notEqual(dynamicSettings(dynamic), null);
});

test("a partly configured Dynamic wallet is not used", () => {
    const { DYNAMIC_WALLET_PASSWORD: _password, ...partial } = dynamic;
    assert.equal(dynamicSettings(partial), null);
    assert.equal(signerKind(partial), "none");
    assert.equal(signerKind({ ...partial, ...key }), "private-key");
});

test("a malformed raw key is not a signer", () => {
    assert.equal(signerKind({ MONSMITH_ATTESTER_KEY: "0x1234" }), "none");
    assert.equal(signerKind({}), "none");
});
