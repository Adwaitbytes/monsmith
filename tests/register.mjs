/**
 * Test-only module hooks.
 *
 * `registerHooks` is the current API but only exists from Node 22.15, and this
 * suite has to run on whatever Node is installed. `register` has been available
 * since 20.6 and does the same job, so the newer one is used when present and
 * the older one otherwise.
 */
import * as module from "node:module";
import { resolve } from "./ts-resolve.mjs";

if (typeof module.registerHooks === "function") {
    module.registerHooks({ resolve });
} else {
    module.register("./ts-resolve.mjs", import.meta.url);
}
