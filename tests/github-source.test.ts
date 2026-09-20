/**
 * What the omnibox has to survive.
 *
 * The single input replaced four separate entry points, which means it now sees
 * whatever is actually on someone's clipboard: the browser URL, a deep link to
 * a file they were reading, an SSH remote copied out of a terminal, or just
 * `owner/repo` typed from memory. Every one of those has to land on the same
 * repository, and anything it does not recognise has to come back null so the
 * omnibox can try reading it as an address or as Solidity instead of throwing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    classifySolidityPath,
    isInterfaceOnly,
    parseRepoInput,
} from "../lib/github/source.ts";

test("the shapes people actually paste all resolve to the same repository", () => {
    const expected = { owner: "monad-labs", repo: "monad" };

    for (const input of [
        "https://github.com/monad-labs/monad",
        "http://github.com/monad-labs/monad",
        "https://www.github.com/monad-labs/monad",
        "github.com/monad-labs/monad",
        "https://github.com/monad-labs/monad.git",
        "git@github.com:monad-labs/monad.git",
        "git@github.com:monad-labs/monad",
        "monad-labs/monad",
        "  https://github.com/monad-labs/monad  ",
    ]) {
        const parsed = parseRepoInput(input);
        assert.equal(parsed?.owner, expected.owner, input);
        assert.equal(parsed?.repo, expected.repo, input);
    }
});

test("a deep link carries its branch, because that is the branch they were reading", () => {
    const parsed = parseRepoInput("https://github.com/foo/bar/tree/develop");
    assert.deepEqual(parsed, { owner: "foo", repo: "bar", ref: "develop" });
});

test("a link into a folder imports that folder, not the whole monorepo", () => {
    const parsed = parseRepoInput("https://github.com/foo/bar/tree/main/packages/core/contracts");
    assert.equal(parsed?.subdir, "packages/core/contracts");
    assert.equal(parsed?.ref, "main");
});

test("a link to a file imports the folder holding it", () => {
    // Someone linking Vault.sol means "audit this project", not "audit one file
    // with none of its imports resolvable".
    const parsed = parseRepoInput("https://github.com/foo/bar/blob/main/contracts/Vault.sol");
    assert.equal(parsed?.subdir, "contracts");
});

test("a branch name containing a slash survives url encoding", () => {
    const parsed = parseRepoInput("https://github.com/foo/bar/tree/feat%2Fvaults");
    assert.equal(parsed?.ref, "feat/vaults");
});

test("query strings and anchors are not part of the path", () => {
    const parsed = parseRepoInput("https://github.com/foo/bar/tree/main/src?plain=1#L20");
    assert.equal(parsed?.ref, "main");
    assert.equal(parsed?.subdir, "src");
});

test("anything unrecognised returns null so the omnibox can try the next reading", () => {
    for (const input of [
        "",
        "   ",
        "0x1234567890123456789012345678901234567890",
        "pragma solidity ^0.8.24; contract A {}",
        "https://gitlab.com/foo/bar",
        "just some words",
    ]) {
        assert.equal(parseRepoInput(input), null, JSON.stringify(input));
    }
});

test("a repository's own contracts are audited and its dependencies are not", () => {
    assert.equal(classifySolidityPath("contracts/Vault.sol").audit, true);
    assert.equal(classifySolidityPath("src/Token.sol").audit, true);

    for (const path of [
        "node_modules/@openzeppelin/contracts/token/ERC20/ERC20.sol",
        "lib/forge-std/src/Test.sol",
        "lib/openzeppelin-contracts/contracts/access/Ownable.sol",
        "out/Vault.sol",
        "artifacts/Vault.sol",
    ]) {
        assert.equal(classifySolidityPath(path).audit, false, path);
    }
});

test("tests and scripts are excluded, since a deliberate bug is not a finding", () => {
    for (const path of [
        "test/Vault.t.sol",
        "tests/Vault.sol",
        "src/mocks/MockToken.sol",
        "script/Deploy.s.sol",
        "contracts/Vault.test.sol",
    ]) {
        assert.equal(classifySolidityPath(path).audit, false, path);
    }
});

test("a path that is not Solidity is never audited", () => {
    assert.equal(classifySolidityPath("README.md").audit, false);
    assert.equal(classifySolidityPath("package.json").audit, false);
    // Case is not a signal of intent.
    assert.equal(classifySolidityPath("contracts/Vault.SOL").audit, true);
});

test("a file declaring only an interface is not a contract to audit", () => {
    assert.equal(isInterfaceOnly("interface IVault { function deposit() external; }"), true);
    assert.equal(isInterfaceOnly("library Math { function max() internal {} }"), true);
    assert.equal(isInterfaceOnly("abstract contract Base { }"), true);
    assert.equal(isInterfaceOnly("contract Vault { }"), false);
});

test("a contract is not hidden by a comment that mentions an interface", () => {
    const source = `
        // interface IVault is what this implements
        /* interface IOther { } */
        contract Vault is IVault { }
    `;
    assert.equal(isInterfaceOnly(source), false);
});
