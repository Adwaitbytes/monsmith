/**
 * The guard that decides whether an AI rewrite is safe to offer.
 *
 * A rewrite that raises the parallelism score by quietly dropping a function is
 * worse than no rewrite at all, so these tests pin the cases the checker must
 * catch before the result ever reaches the editor.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkCompatibility, publicInterface } from "../lib/parallel/compatibility.ts";
import { analyzeParallelPotential } from "../lib/parallel/analyzer.ts";

const ORIGINAL = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Points {
    address public owner;
    uint256 public totalPoints;
    mapping(address => uint256) public points;
    mapping(address => mapping(address => bool)) public delegated;

    event Earned(address indexed who, uint256 amount);

    function earn(uint256 amount) external {
        points[msg.sender] += amount;
        totalPoints += amount;
        emit Earned(msg.sender, amount);
    }

    function donate() external payable {}

    function score(address who) external view returns (uint256) {
        return points[who];
    }
}
`;

/** The rewrite a good model produces: the counter is striped, nothing is lost. */
const STRIPED = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Points {
    address public owner;
    uint256[64] private _totalStripes;
    mapping(address => uint256) public points;
    mapping(address => mapping(address => bool)) public delegated;

    event Earned(address indexed who, uint256 amount);

    function earn(uint256 amount) external {
        points[msg.sender] += amount;
        _totalStripes[uint256(uint160(msg.sender)) % 64] += amount;
        emit Earned(msg.sender, amount);
    }

    function totalPoints() public view returns (uint256 total) {
        for (uint256 i = 0; i < 64; i++) total += _totalStripes[i];
    }

    function donate() external payable {}

    function score(address who) external view returns (uint256) {
        return points[who];
    }
}
`;

test("a public state variable's generated getter is part of the interface", () => {
    const members = publicInterface(ORIGINAL, "Points").map((member) => member.signature);

    assert.ok(members.includes("totalPoints()"));
    assert.ok(members.includes("points(address)"));
    assert.ok(members.includes("delegated(address,address)"), "a nested mapping getter takes both keys");
    assert.ok(members.includes("Earned(address,uint256)"));
});

test("striping a counter behind a getter of the same name is compatible", () => {
    const report = checkCompatibility(ORIGINAL, STRIPED, "Points");

    assert.equal(report.compatible, true, JSON.stringify(report.missing));
    assert.deepEqual(report.weakened, []);
    assert.equal(report.missing.length, 0);
});

test("striping a counter is what actually raises the score", () => {
    const before = analyzeParallelPotential(ORIGINAL, "Points");
    const after = analyzeParallelPotential(STRIPED, "Points");

    assert.ok(before.metrics.pairsBlocked > 0, "the shared counter blocks pairs to begin with");
    assert.equal(after.metrics.pairsBlocked, 0);
    assert.ok(after.score > before.score);
});

test("a dropped function is rejected", () => {
    const withoutScore = STRIPED.replace(/function score[\s\S]*?\n    \}/, "");
    const report = checkCompatibility(ORIGINAL, withoutScore, "Points");

    assert.equal(report.compatible, false);
    assert.deepEqual(report.missing.map((member) => member.signature), ["score(address)"]);
});

test("a changed parameter type is a different function, not the same one", () => {
    const retyped = STRIPED.replace("function earn(uint256 amount)", "function earn(uint128 amount)");
    const report = checkCompatibility(ORIGINAL, retyped, "Points");

    assert.equal(report.compatible, false);
    assert.ok(report.missing.some((member) => member.signature === "earn(uint256)"));
});

test("a dropped event is rejected", () => {
    const withoutEvent = STRIPED.replace("event Earned(address indexed who, uint256 amount);", "");
    const report = checkCompatibility(ORIGINAL, withoutEvent, "Points");

    assert.equal(report.compatible, false);
    assert.ok(report.missing.some((member) => member.kind === "event"));
});

test("silently dropping payable is flagged even though the signature survives", () => {
    const notPayable = STRIPED.replace("function donate() external payable", "function donate() external");
    const report = checkCompatibility(ORIGINAL, notPayable, "Points");

    assert.equal(report.compatible, false);
    assert.deepEqual(report.weakened, ["donate() is no longer payable"]);
});

test("only a slot every write builds on is treated as strippable", () => {
    const accumulating = analyzeParallelPotential(`
        pragma solidity ^0.8.24;
        contract A {
            uint256 public total;
            function add(uint256 n) external { total += n; }
            function bump() external { total = total + 1; }
        }
    `);
    const reassigned = analyzeParallelPotential(`
        pragma solidity ^0.8.24;
        contract B {
            uint256 public reserve;
            function add(uint256 n) external { reserve += n; }
            function sync(uint256 v) external { reserve = v; }
        }
    `);

    assert.equal(accumulating.hotspots[0].accumulator, true, "+= and x = x + 1 both accumulate");
    assert.equal(reassigned.hotspots[0].accumulator, false, "an outright assignment cannot be summed from stripes");
    assert.ok(!reassigned.suggestions.some((s) => s.type === "shard_counter"), "never advise striping a reserve");
});

test("hotspots are ranked by the pairs they actually block", () => {
    const result = analyzeParallelPotential(`
        pragma solidity ^0.8.24;
        contract C {
            uint256 public hot;
            uint256 public cold;
            function a() external { hot += 1; }
            function b() external { hot += 2; }
            function c() external { hot += 3; cold = 1; }
        }
    `);

    assert.equal(result.hotspots[0].variable, "hot");
    assert.ok(result.hotspots[0].blockedPairs > result.hotspots[1].blockedPairs);
});
