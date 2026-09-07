/**
 * What the migration is allowed to change.
 *
 * The rule these assertions protect: a transform that leaves the contract
 * unbuildable is worse than no transform, because the result looks like it
 * worked. Raising the pragma broke that rule twice. On a flattened project it
 * rewrote the first of several pragmas and left `^0.8.24` above `=0.7.6`, which
 * no compiler satisfies. Done correctly across every pragma it would still fail,
 * because moving real 0.7 code to 0.8 needs explicit conversions and SafeCast
 * unwound.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { transformForMonad, checkMonadCompatibility } from "../lib/migrationTool.ts";

const FLATTENED = `// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma solidity >=0.5.0;
pragma solidity >=0.4.0 <0.8.0;

// File: contracts/libraries/Tick.sol
library Tick { function f() internal pure returns (uint256) { return 1; } }

// File: contracts/UniswapV3Pool.sol
contract UniswapV3Pool { uint256 public x; }
`;

test("a flattened project keeps every pragma it arrived with", () => {
    const result = transformForMonad(FLATTENED, true);
    const pragmas = result.migratedCode.match(/pragma solidity[^;]*;/g) ?? [];

    assert.deepEqual(pragmas, [
        "pragma solidity =0.7.6;",
        "pragma solidity >=0.5.0;",
        "pragma solidity >=0.4.0 <0.8.0;",
    ]);
    assert.ok(
        !result.migratedCode.includes("^0.8.24"),
        "injecting a newer pragma alongside a pinned one leaves nothing that satisfies both",
    );
});

test("no change claims to have upgraded the compiler", () => {
    const result = transformForMonad(FLATTENED, true);
    const pragmaChanges = result.changes.filter((change) => change.type === "pragma");
    assert.deepEqual(pragmaChanges, [], "the compiler version is reported, never rewritten");
});

test("an old compiler is reported rather than treated as a defect", () => {
    const issues = checkMonadCompatibility("pragma solidity =0.7.6;\ncontract A {}");
    const version = issues.find((issue) => issue.type === "compiler_version");

    assert.ok(version, "the version is still worth telling the reader about");
    assert.equal(version.severity, "info", "Monad runs it as-is, so this is not a problem to fix");
    assert.equal(
        version.fix?.autoFixable,
        false,
        "offering a one-click upgrade promises something a regex cannot deliver",
    );
});

test("a single old pragma is also left alone", () => {
    const source = "// SPDX-License-Identifier: MIT\npragma solidity ^0.6.12;\ncontract A { uint256 x; }";
    const result = transformForMonad(source, true);
    assert.ok(result.migratedCode.includes("pragma solidity ^0.6.12;"));
    assert.ok(!result.migratedCode.includes("0.8.24"));
});

test("changes that do not risk the build still apply", () => {
    // tx.origin is a real Monad-relevant fix and does not depend on the compiler.
    const source = "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\ncontract A { address a = tx.origin; }";
    const result = transformForMonad(source, true);
    assert.ok(result.migratedCode.includes("msg.sender"));
    assert.ok(!result.migratedCode.includes("tx.origin"));
});
