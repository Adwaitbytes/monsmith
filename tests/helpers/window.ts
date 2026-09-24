/**
 * A `window` for Node, for the modules that check for one.
 *
 * Browser-only helpers guard with `typeof window === "undefined"` and return a
 * neutral value on the server, which in a test run means the assertion passes
 * against the server path and never touches the code it was written for.
 *
 * Its own file, imported above the module under test, because that guard is
 * read at call time and the shim has to exist first. Kept out of the shared
 * localStorage helper deliberately: declaring a global `window` changes which
 * branch every module in the process takes, so only the files that want it
 * should get it.
 */

import './local-storage.ts';

const shim = {
    localStorage: globalThis.localStorage,
    crypto: globalThis.crypto,
};

(globalThis as { window?: unknown }).window ??= shim;
