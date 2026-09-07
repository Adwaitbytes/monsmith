/**
 * Stands in for `server-only`, which throws on import outside a Next.js server
 * build. Modules under test import it as a real guard, so it is stubbed here
 * rather than removed from the source, which would drop the protection in
 * production to make a test pass.
 *
 * Written to satisfy both hook APIs: `registerHooks` calls `resolve`
 * synchronously, `register` calls it asynchronously, and returning a plain
 * object works for either.
 */
const STUBS = new Map([["server-only", new URL("./server-only-stub.mjs", import.meta.url).href]]);

export function resolve(specifier, context, nextResolve) {
    const stub = STUBS.get(specifier);
    if (stub !== undefined) return { url: stub, shortCircuit: true };
    return nextResolve(specifier, context);
}
