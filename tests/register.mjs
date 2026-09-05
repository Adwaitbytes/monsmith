/** Installs the extension-tolerant resolver used by the Chain Fit tests. */
import { registerHooks } from "node:module";
import { resolve } from "./ts-resolve.mjs";

registerHooks({ resolve });
