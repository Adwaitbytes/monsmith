/**
 * Flattening, which decides whether an imported contract compiles at all.
 *
 * Concatenation leaves the relative imports in place, and a single document has
 * no such paths, so the compiler rejects it before parsing any Solidity. That
 * was the actual failure: importing Uniswap V3 produced a file with twenty-odd
 * unresolvable imports and several conflicting licences.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { flattenSources } from "../lib/flatten.ts";

test("imports are removed in every form the language allows", () => {
    const files = new Map([
        [
            "A.sol",
            `// SPDX-License-Identifier: MIT
pragma solidity =0.7.6;
import './B.sol';
import "./lib/C.sol";
import {D, E} from './D.sol';
import * as F from "./F.sol";
import G from './G.sol';
contract A {}`,
        ],
    ]);

    const { source } = flattenSources(files);
    assert.ok(!/^\s*import/m.test(source), `an import survived:\n${source}`);
    assert.ok(source.includes("contract A {}"));
});

test("only one licence survives, and the dropped ones are reported", () => {
    const files = new Map([
        ["A.sol", "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract A {}"],
        ["B.sol", "// SPDX-License-Identifier: GPL-2.0-or-later\npragma solidity ^0.8.0;\ncontract B {}"],
        ["C.sol", "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract C {}"],
    ]);

    const result = flattenSources(files);
    const licences = result.source.match(/SPDX-License-Identifier/g) ?? [];
    assert.equal(licences.length, 1, "solc rejects a file declaring more than one licence");
    assert.equal(result.license, "MIT");
    assert.deepEqual(result.discardedLicenses, ["GPL-2.0-or-later"]);
});

test("repeated pragmas collapse but distinct ones are all kept", () => {
    const files = new Map([
        ["A.sol", "pragma solidity =0.7.6;\npragma abicoder v2;\ncontract A {}"],
        ["B.sol", "pragma solidity =0.7.6;\ncontract B {}"],
        ["C.sol", "pragma solidity >=0.5.0;\ncontract C {}"],
    ]);

    const result = flattenSources(files);
    assert.deepEqual(result.pragmas, [
        "pragma solidity =0.7.6;",
        "pragma abicoder v2;",
        "pragma solidity >=0.5.0;",
    ]);
    // Keeping every distinct constraint lets the compiler resolve the same
    // intersection it would have resolved across the original files.
    assert.equal((result.source.match(/pragma solidity/g) ?? []).length, 2);
});

test("dependencies precede the contract that uses them", () => {
    // Within one file Solidity requires a base to be declared before the
    // contract deriving from it, which is the whole reason ordering matters.
    // Across separate files the imports establish that and order is free.
    const files = new Map([
        ["Base.sol", "pragma solidity ^0.8.0;\ncontract Base {}"],
        ["Main.sol", "pragma solidity ^0.8.0;\nimport './Base.sol';\ncontract Main is Base {}"],
    ]);

    const { source } = flattenSources(files, "Main.sol");
    assert.ok(
        source.indexOf("contract Base") < source.indexOf("contract Main is Base"),
        "a base declared after its derived contract does not compile",
    );
});

test("the primary survives when a copy of it exists under another path", () => {
    // Verified projects list the same file under several paths. Deduplicating
    // without preferring the primary drops the one contract the document is for.
    const body = "pragma solidity =0.7.6;\ncontract Pool { uint256 x; }";
    const files = new Map([
        ["./contracts/Pool.sol", body],
        ["contracts/Pool.sol", body + " // canonical"],
    ]);

    const result = flattenSources(files, "contracts/Pool.sol");
    assert.equal(result.duplicatesDropped, 1);
    assert.equal(result.primaryContract, "Pool");
    assert.ok(result.source.includes("// canonical"), "the primary copy is the one kept");
});

test("every file's body is preserved", () => {
    const files = new Map([
        ["A.sol", "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\nimport './B.sol';\ncontract A is B { uint256 x; }"],
        ["B.sol", "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract B { uint256 y; }"],
    ]);

    const { source, fileCount } = flattenSources(files, "A.sol");
    assert.equal(fileCount, 2);
    assert.ok(source.includes("contract A is B { uint256 x; }"));
    assert.ok(source.includes("contract B { uint256 y; }"));
    assert.ok(source.includes("// File: A.sol"));
});

test("an empty map does not produce a broken document", () => {
    const result = flattenSources(new Map());
    assert.equal(result.source, "");
    assert.equal(result.fileCount, 0);
});

test("a string that merely mentions import is not stripped", () => {
    const files = new Map([
        ["A.sol", `pragma solidity ^0.8.0;\ncontract A { string s = "import './x.sol';"; }`],
    ]);
    const { source } = flattenSources(files);
    assert.ok(source.includes(`string s = "import './x.sol';"`), "only leading imports are directives");
});
