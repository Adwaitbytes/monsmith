/**
 * Behaviour of the parallel execution analyser.
 *
 * These fixtures exist because the previous implementation reported a
 * flattened Uniswap file as one 35-function contract whose worst conflicts
 * were on `amount0In` and `digest`: both stack variables. Each test below
 * pins one of the properties that made those answers wrong.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { analyzeParallelPotential } from "../lib/parallel/analyzer.ts";
import { parseSolidity } from "../lib/parallel/parser.ts";

const CALLER_KEYED = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Registry {
    mapping(address => uint256) public balance;
    uint256 public constant FEE = 1e15;
    address public immutable treasury;

    constructor(address t) { treasury = t; }

    function deposit() external payable {
        balance[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        uint256 available = balance[msg.sender];
        require(available >= amount, "low");
        balance[msg.sender] = available - amount;
    }

    function balanceOf(address who) external view returns (uint256) {
        return balance[who];
    }
}
`;

const SHARED_COUNTER = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Counter {
    uint256 public total;

    function increment() external { total += 1; }
    function reset() external { total = 0; }
    function get() external view returns (uint256) { return total; }
}
`;

const INDIRECT = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Vault {
    uint256 private _fees;
    mapping(address => uint256) private _shares;

    modifier onlyPositive(uint256 amount) {
        require(amount > 0, "zero");
        _;
    }

    function _accrue(uint256 amount) private {
        _fees += amount / 100;
    }

    function join(uint256 amount) external onlyPositive(amount) {
        _shares[msg.sender] += amount;
        _accrue(amount);
    }
}
`;

const MULTI_UNIT = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IThing { function ping() external; }

library MathLib {
    function double(uint256 x) internal pure returns (uint256) { return x * 2; }
}

contract Base {
    mapping(address => uint256) internal _held;
    function held(address who) external view returns (uint256) { return _held[who]; }
}

contract Main is Base {
    function store(uint256 amount) external {
        _held[msg.sender] = MathLib.double(amount);
    }

    function move(address to, uint256 amount) external {
        _held[msg.sender] -= amount;
        _held[to] += amount;
    }
}
`;

const SHADOWING = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Shadow {
    uint256 public reserve;
    mapping(address => uint256) public credit;

    function quote(uint256 amountIn) external returns (uint256) {
        // Every identifier below is a local, and a comment naming reserve
        // must not register as a storage read either.
        uint256 reserveIn = amountIn * 2;
        (uint256 a, uint256 b) = (reserveIn, amountIn);
        credit[msg.sender] = a + b;
        return a;
    }
}
`;

test("caller-keyed state scores as fully parallel", () => {
    const result = analyzeParallelPotential(CALLER_KEYED);

    assert.equal(result.contract, "Registry");
    assert.equal(result.score, 100);
    assert.equal(result.grade, "A");
    assert.equal(result.totalFunctions, 2, "view functions are not transactions");
    assert.equal(result.metrics.pairsBlocked, 0);
    assert.deepEqual(result.readOnlyFunctions.map((f) => f.name), ["balanceOf"]);
});

test("constants and immutables never count as contended state", () => {
    const result = analyzeParallelPotential(CALLER_KEYED);
    const names = result.hotspots.map((h) => h.variable);

    assert.ok(!names.includes("FEE"));
    assert.ok(!names.includes("treasury"));
});

test("a single function sharing one slot with itself is serial", () => {
    const result = analyzeParallelPotential(SHARED_COUNTER);

    assert.equal(result.grade, "F");
    assert.equal(result.score, 0);
    assert.equal(result.parallelizableFunctions, 0);

    const increment = result.entrypoints.find((e) => e.name === "increment");
    assert.ok(increment);
    assert.equal(increment.contention, "serial");
    assert.ok(increment.conflictsWith.includes("increment"), "concurrent callers collide with each other");
});

test("effects propagate through private calls and modifiers", () => {
    const result = analyzeParallelPotential(INDIRECT);
    const join = result.entrypoints.find((e) => e.name === "join");

    assert.ok(join);
    assert.ok(join.through.includes("_accrue"), "the private helper is credited");
    assert.ok(join.through.includes("onlyPositive"), "modifier bodies are part of the footprint");

    const fees = join.writes.find((w) => w.variable === "_fees");
    assert.ok(fees, "the slot written only by the helper is attributed to the entrypoint");
    assert.equal(fees.scope, "global");
    assert.equal(join.contention, "serial");
});

test("a flattened file is analysed one contract at a time", () => {
    const result = analyzeParallelPotential(MULTI_UNIT);

    assert.equal(result.contract, "Main", "the contract with real entrypoints is chosen");
    assert.deepEqual(
        result.availableContracts.map((c) => c.name).sort(),
        ["Base", "Main"],
        "interfaces and libraries are not deployable targets"
    );
    assert.equal(result.totalFunctions, 2);

    const held = result.hotspots.find((h) => h.variable === "_held");
    assert.ok(held, "state inherited from a base contract is included");
    assert.equal(held.scope, "keyed", "move() writes an arbitrary key, not just the caller's");
});

test("an explicitly requested contract overrides the primary pick", () => {
    const result = analyzeParallelPotential(MULTI_UNIT, "Base");
    assert.equal(result.contract, "Base");
    assert.equal(result.totalFunctions, 0);
});

test("locals, tuple bindings and comments are not storage", () => {
    const result = analyzeParallelPotential(SHADOWING);
    const quote = result.entrypoints.find((e) => e.name === "quote");

    assert.ok(quote);
    assert.deepEqual(quote.writes.map((w) => w.variable), ["credit"]);
    assert.ok(!quote.reads.some((r) => r.variable === "reserve"), "the comment mentioning reserve is not a read");
    assert.equal(quote.contention, "independent");
});

test("the parser separates units, bases and declaration kinds", () => {
    const units = parseSolidity(MULTI_UNIT);

    assert.deepEqual(units.map((u) => u.name), ["IThing", "MathLib", "Base", "Main"]);
    assert.equal(units.find((u) => u.name === "MathLib")?.kind, "library");
    assert.deepEqual(units.find((u) => u.name === "Main")?.bases, ["Base"]);
    assert.deepEqual(units.find((u) => u.name === "Main")?.stateVariables, []);
    assert.deepEqual(
        units.find((u) => u.name === "Base")?.stateVariables.map((v) => v.name),
        ["_held"]
    );
});

test("an empty or non-contract source degrades without throwing", () => {
    const result = analyzeParallelPotential("interface Only { function a() external; }");

    assert.equal(result.totalFunctions, 0);
    assert.equal(result.entrypoints.length, 0);
    assert.match(result.summary, /No deployable contract/);
});

test("a contract whose entrypoints all come from imports is not scored as perfect", () => {
    // Every entrypoint lives in Governor, which is imported rather than declared.
    // Scoring this 100/A would report a contract nobody looked at as ideal.
    const source = `
        // SPDX-License-Identifier: MIT
        pragma solidity ^0.8.20;
        import "@openzeppelin/contracts/governance/Governor.sol";
        contract MetaverseDAO is Governor {
            constructor() Governor("MetaverseDAO") {}
        }
    `;
    const result = analyzeParallelPotential(source);

    assert.equal(result.totalFunctions, 0);
    assert.notEqual(result.score, 100, "an unexamined contract must not score perfectly");
    assert.match(result.headline, /not scored/i);
    assert.match(result.summary, /Governor/);
});

test("an inherited base is disclosed as outside the score", () => {
    const source = `
        // SPDX-License-Identifier: MIT
        pragma solidity ^0.8.20;
        import "@openzeppelin/contracts/access/Ownable.sol";
        contract Vault is Ownable {
            uint256 public total;
            function deposit(uint256 amount) external { total += amount; }
        }
    `;
    const result = analyzeParallelPotential(source);

    assert.equal(result.totalFunctions, 1, "the declared entrypoint is still analysed");
    assert.ok(
        result.notes.some((note) => note.includes("Ownable") && /outside this score/.test(note)),
        "the unresolved base is named in the notes",
    );
});

test("a contract with only view functions is unscored rather than graded", () => {
    const source = `
        // SPDX-License-Identifier: MIT
        pragma solidity ^0.8.20;
        contract Oracle {
            uint256 private price;
            function read() external view returns (uint256) { return price; }
        }
    `;
    const result = analyzeParallelPotential(source);

    assert.equal(result.totalFunctions, 0);
    assert.notEqual(result.score, 100);
    assert.deepEqual(result.readOnlyFunctions.map((f) => f.name), ["read"]);
});
