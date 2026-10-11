/**
 * Crediting the model that cross-examined a report's findings.
 *
 * What matters: a report only names a reviewer for contracts the review pass
 * actually ran on, and never invents one when none did.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { modelName, verificationSentence, verificationSummary } from "../lib/report/verification.ts";
import type { ContractReport } from "../lib/report/types.ts";

const contract = (verification?: ContractReport["verification"]) =>
    ({ id: "c", path: "c.sol", name: "C", health: null, findings: [], counts: {}, sections: {}, ...(verification === undefined ? {} : { verification }) }) as unknown as ContractReport;

test("model ids read as names, and unknown ids are shown as they are", () => {
    assert.equal(modelName("qwen/qwen3.8-max-0902"), "Qwen 3.8 Max");
    assert.equal(modelName("anthropic/claude-sonnet-5.5"), "Claude Sonnet 5.5");
    assert.equal(modelName("someone/new-model"), "someone/new-model");
});

test("no reviewer is credited when the review ran on no contract", () => {
    assert.equal(verificationSummary({ contracts: [contract(), contract()] }), null);
    assert.equal(verificationSummary({ contracts: [] }), null);
});

test("totals add up across contracts and each model is named once", () => {
    const summary = verificationSummary({
        contracts: [
            contract({ model: "qwen/qwen3.8-max-0902", upheld: 3, rejected: 1 }),
            contract(),
            contract({ model: "qwen/qwen3.8-max-0902", upheld: 1, rejected: 0 }),
        ],
    });
    assert.deepEqual(summary, { models: ["Qwen 3.8 Max"], upheld: 4, rejected: 1 });
    assert.equal(
        verificationSentence(summary!),
        "Every AI finding was cross-examined by Qwen 3.8 Max: 4 findings upheld, 1 candidate rejected for lack of a working attack.",
    );
});
