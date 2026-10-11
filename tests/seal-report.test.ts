/**
 * The sealed report format around Mera's passkey vault.
 *
 * The encryption itself is Mera's and needs a real passkey; what is tested
 * here is everything around it: the file round trip, refusing what is not a
 * sealed report, and which domain a passkey is scoped to.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeContent, encodeContent, explainSealError, parseSealed, relyingPartyId, wrapSealed } from "../lib/seal/sealedReport.ts";

test("a passkey made on any monsmith.com host opens files on all of them", () => {
    assert.equal(relyingPartyId("www.monsmith.com"), "monsmith.com");
    assert.equal(relyingPartyId("monsmith.com"), "monsmith.com");
    assert.equal(relyingPartyId("localhost"), "localhost");
    assert.equal(relyingPartyId("evil-monsmith.com"), "evil-monsmith.com");
});

test("a sealed file survives being written and read back", () => {
    const file = wrapSealed({ reportId: "r1", title: "TheDAO", sealedAt: "2026-10-11T00:00:00.000Z" }, { version: 1, ciphertext: "abc" });
    const parsed = parseSealed(JSON.stringify(file));
    assert.equal(parsed.title, "TheDAO");
    assert.deepEqual(parsed.vault, { version: 1, ciphertext: "abc" });
});

test("anything that is not a sealed report is refused with a reason", () => {
    assert.throws(() => parseSealed("not json"), /not a sealed Monsmith report/);
    assert.throws(() => parseSealed(JSON.stringify({ format: "other" })), /not a sealed Monsmith report/);
    assert.throws(() => parseSealed(JSON.stringify({ format: "monsmith.sealed-report", version: 2 })), /newer version/);
    assert.throws(() => parseSealed(JSON.stringify({ format: "monsmith.sealed-report", version: 1, title: "x" })), /damaged/);
});

test("the contents round trip, and a wrong shape is caught after decryption", () => {
    const content = { reportId: "r1", title: "TheDAO", markdown: "# Report\n\nsplitDAO is re-entrant." };
    assert.deepEqual(decodeContent(encodeContent(content)), content);
    assert.throws(() => decodeContent(new TextEncoder().encode(JSON.stringify({ hello: 1 }))), /not a report/);
});

test("Mera's error codes become instructions", () => {
    assert.match(explainSealError({ code: "PRF_UNAVAILABLE" }), /Google Password Manager/);
    assert.match(explainSealError({ code: "DECRYPT_FAILED" }), /did not seal this report/);
});
