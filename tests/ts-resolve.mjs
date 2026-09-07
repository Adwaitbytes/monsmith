/**
 * Node module resolver hook for the Chain Fit test suite.
 *
 * The application's imports are written for a bundler, so relative specifiers
 * carry no file extension. Node's ESM resolver requires one. Rather than
 * duplicating the modules under test with test-only copies that carry
 * extensions, this hook retries an unresolved relative import with the
 * extensions the project actually uses, so the tests run the real files.
 */

const CANDIDATE_SUFFIXES = [".ts", ".tsx", ".js", "/index.ts", "/index.js"];

/**
 * `server-only` throws on import outside a Next.js server build. Modules under
 * test import it as a real guard, so it is stubbed here rather than removed
 * from the source, which would drop the protection to make a test pass.
 */
const STUBS = new Map([["server-only", new URL("./server-only-stub.mjs", import.meta.url).href]]);

export function resolve(specifier, context, nextResolve) {
    const stub = STUBS.get(specifier);
    if (stub !== undefined) return { url: stub, shortCircuit: true };

    try {
        return nextResolve(specifier, context);
    } catch (error) {
        const relative = specifier.startsWith("./") || specifier.startsWith("../");
        const hasExtension = /\.[cm]?[jt]sx?$/.test(specifier);
        if (!relative || hasExtension) throw error;

        for (const suffix of CANDIDATE_SUFFIXES) {
            try {
                return nextResolve(specifier + suffix, context);
            } catch {
                // Try the next candidate.
            }
        }
        throw error;
    }
}
