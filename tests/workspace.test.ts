/**
 * The workspace, which is what "my files disappeared" was about.
 *
 * The old studio kept files in component state and seeded them on every mount,
 * so a reload restored the default and a deliberate delete was indistinguishable
 * from closing the tab. These assertions cover the two halves of that: a delete
 * has to stick, and a reopen must not overwrite what is already there.
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Installed by importing it, and ordered above the module under test because
// zustand reaches for localStorage while that module is being evaluated.
import "./helpers/local-storage.ts";

import {
    folderSet,
    normalisePath,
    seedWorkspace,
    solidityFiles,
    useWorkspace,
} from "../lib/workspace.ts";

beforeEach(() => {
    useWorkspace.getState().reset({}, undefined);
    useWorkspace.setState({ folders: [] });
});

test("paths are normalised so the same file cannot exist twice", () => {
    assert.equal(normalisePath("/contracts//A.sol"), "contracts/A.sol");
    assert.equal(normalisePath("contracts/A.sol/"), "contracts/A.sol");
    assert.equal(normalisePath("  contracts/A.sol  "), "contracts/A.sol");
    assert.equal(normalisePath("contracts\\A.sol"), "contracts/A.sol");
});

test("seeding only fires on a genuinely empty workspace", () => {
    seedWorkspace("// default");
    assert.deepEqual(Object.keys(useWorkspace.getState().files), ["contracts/MyToken.sol"]);

    // Someone edits, then reopens the studio. Seeding again would restore the
    // default over their work, which is exactly what used to happen.
    useWorkspace.getState().writeFile("contracts/MyToken.sol", "// mine");
    seedWorkspace("// default");
    assert.equal(useWorkspace.getState().files["contracts/MyToken.sol"], "// mine");
});

test("a delete sticks, and does not come back on the next open", () => {
    useWorkspace.getState().reset({ "a.sol": "A", "b.sol": "B" }, "a.sol");
    useWorkspace.getState().deleteFile("a.sol");

    assert.deepEqual(Object.keys(useWorkspace.getState().files), ["b.sol"]);
    seedWorkspace("// default");
    assert.deepEqual(Object.keys(useWorkspace.getState().files), ["b.sol"], "seeding must not resurrect it");
});

test("deleting the open file opens another rather than leaving nothing open", () => {
    useWorkspace.getState().reset({ "a.sol": "A", "b.sol": "B" }, "a.sol");
    useWorkspace.getState().deleteFile("a.sol");
    assert.equal(useWorkspace.getState().activePath, "b.sol");
});

test("renaming keeps the contents, the position and the open file", () => {
    useWorkspace.getState().reset({ "a.sol": "A", "b.sol": "B", "c.sol": "C" }, "b.sol");
    assert.equal(useWorkspace.getState().renameFile("b.sol", "renamed.sol"), true);

    const state = useWorkspace.getState();
    assert.equal(state.files["renamed.sol"], "B");
    assert.equal(state.files["b.sol"], undefined);
    assert.equal(state.activePath, "renamed.sol");
    assert.deepEqual(
        Object.keys(state.files),
        ["a.sol", "renamed.sol", "c.sol"],
        "a rename should not move the file to the end of the tree",
    );
});

test("a rename onto an existing file is refused rather than overwriting it", () => {
    useWorkspace.getState().reset({ "a.sol": "A", "b.sol": "B" }, "a.sol");
    assert.equal(useWorkspace.getState().renameFile("a.sol", "b.sol"), false);
    assert.equal(useWorkspace.getState().files["b.sol"], "B");
});

test("creating a file that already exists does not clobber it", () => {
    useWorkspace.getState().reset({ "a.sol": "original" }, "a.sol");
    assert.equal(useWorkspace.getState().createFile("a.sol", "replacement"), false);
    assert.equal(useWorkspace.getState().files["a.sol"], "original");
});

test("deleting a folder takes everything under it and nothing beside it", () => {
    useWorkspace.getState().reset(
        { "lib/a.sol": "A", "lib/deep/b.sol": "B", "libs/c.sol": "C", "top.sol": "T" },
        "lib/a.sol",
    );
    useWorkspace.getState().deleteFolder("lib");

    assert.deepEqual(Object.keys(useWorkspace.getState().files).sort(), ["libs/c.sol", "top.sol"]);
    assert.ok(useWorkspace.getState().activePath !== "lib/a.sol");
});

test("folders come from the paths, plus any created empty", () => {
    const files = { "contracts/token/A.sol": "A", "test/B.sol": "B" };
    const derived = folderSet(files, []);
    assert.deepEqual([...derived].sort(), ["contracts", "contracts/token", "test"]);

    // An empty folder has to be tracked, or it vanishes the moment you make it.
    const withEmpty = folderSet(files, ["scripts/deploy"]);
    assert.ok(withEmpty.has("scripts"));
    assert.ok(withEmpty.has("scripts/deploy"));
});

test("editing does not bump the structural revision", () => {
    useWorkspace.getState().reset({ "a.sol": "A" }, "a.sol");
    const before = useWorkspace.getState().revision;

    // Fires on every keystroke; anything watching structure must not re-run.
    useWorkspace.getState().writeFile("a.sol", "AA");
    assert.equal(useWorkspace.getState().revision, before);

    useWorkspace.getState().createFile("b.sol", "B");
    assert.equal(useWorkspace.getState().revision, before + 1);
});

test("only Solidity is handed to the compiler", () => {
    const sources = solidityFiles({
        "a.sol": "A",
        "notes.md": "hello",
        "abi.json": "{}",
        "nested/b.sol": "B",
    });
    assert.deepEqual(Object.keys(sources).sort(), ["a.sol", "nested/b.sol"]);
});

/**
 * Opening a file has to be something the caller can check.
 *
 * The explorer used to hand the clicked path to an `onOpen` callback and stop
 * there. The host only logged it, so the console filled with "Opened:
 * MyToken.sol" while the tree stayed highlighted on another file and the editor
 * never changed. Selection now goes through the store, and the store says
 * whether it actually opened anything.
 */

test("opening a file reports that it worked", () => {
    useWorkspace.getState().reset({ "a.sol": "A", "b.sol": "B" }, "a.sol");

    assert.equal(useWorkspace.getState().setActive("b.sol"), true);
    assert.equal(useWorkspace.getState().activePath, "b.sol");
});

test("opening a file that is not there reports failure rather than doing nothing quietly", () => {
    useWorkspace.getState().reset({ "a.sol": "A" }, "a.sol");

    assert.equal(useWorkspace.getState().setActive("gone.sol"), false);
    assert.equal(useWorkspace.getState().activePath, "a.sol", "the open file must not change");
});

test("renaming a file that is not open leaves the open file alone", () => {
    // The explorer announces the renamed path as opened, so it has to open it:
    // renameFile only moves activePath when the renamed file was the open one.
    useWorkspace.getState().reset({ "a.sol": "A", "b.sol": "B" }, "a.sol");
    assert.equal(useWorkspace.getState().renameFile("b.sol", "c.sol"), true);
    assert.equal(useWorkspace.getState().activePath, "a.sol");

    // Which is why the explorer follows a rename with an explicit open.
    assert.equal(useWorkspace.getState().setActive("c.sol"), true);
    assert.equal(useWorkspace.getState().activePath, "c.sol");
});
