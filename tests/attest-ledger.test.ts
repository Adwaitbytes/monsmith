/**
 * Reading Monsmith's attestation history from Envio HyperSync.
 *
 * The logs are encoded here the way the contract emits them, so the test
 * checks the decoding against the real event layout rather than a fixture
 * someone typed by hand.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics } from "viem";

import { ATTESTATIONS_ABI } from "../lib/attest/chain.ts";
import { decodeHyperSyncPage, withHistory } from "../lib/attest/ledger.ts";

const SOURCE = `0x${"11".repeat(32)}` as const;
const TARGET = "0x00000000000000000000000000000000000000aa" as const;

function log(block: number, score: number, sourceHash: `0x${string}` = SOURCE) {
    // Every topic of this event is a single value, never a list of alternatives.
    const [topic0, topic1, topic2, topic3] = encodeEventTopics({
        abi: ATTESTATIONS_ABI,
        eventName: "Attested",
        args: { sourceHash, chainId: 143n, target: TARGET },
    }) as string[];
    const data = encodeAbiParameters(
        [{ type: "uint8" }, { type: "uint16" }, { type: "uint16" }, { type: "bytes32" }, { type: "string" }],
        [score, 1, 2, `0x${"33".repeat(32)}`, "https://www.monsmith.com/report/r1"],
    );
    return { block_number: block, transaction_hash: `0x${"44".repeat(32)}`, data, topic0, topic1, topic2, topic3 };
}

test("a HyperSync page decodes into entries, oldest first, with block times", () => {
    const entries = decodeHyperSyncPage({
        data: [
            { logs: [log(20, 79)], blocks: [{ number: 20, timestamp: "0x6700" }] },
            { logs: [log(10, 39)], blocks: [{ number: "0xa", timestamp: 1_700_000_000 }] },
        ],
    });
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((entry) => entry.score), [39, 79]);
    assert.equal(entries[0]?.timestamp, 1_700_000_000);
    assert.equal(entries[1]?.timestamp, 0x6700);
    assert.equal(entries[0]?.target.toLowerCase(), TARGET.toLowerCase());
    assert.equal(entries[0]?.auditedChainId, 143);
    assert.equal(entries[0]?.critical, 1);
    assert.equal(entries[0]?.reportURI, "https://www.monsmith.com/report/r1");
});

test("logs that are not Attested events are skipped, and a single batch object is accepted", () => {
    const foreign = { ...log(5, 50), topic0: `0x${"99".repeat(32)}` };
    assert.equal(decodeHyperSyncPage({ data: { logs: [foreign, log(6, 60)] } }).length, 1);
    assert.equal(decodeHyperSyncPage({}).length, 0);
});

test("a second attestation of the same source is marked as a re-audit", () => {
    const entries = decodeHyperSyncPage({ data: [{ logs: [log(1, 39), log(2, 70, `0x${"22".repeat(32)}`), log(3, 82)] }] });
    assert.deepEqual(withHistory(entries).map((entry) => entry.reattested), [false, false, true]);
});
