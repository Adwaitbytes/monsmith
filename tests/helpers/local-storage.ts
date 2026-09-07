/**
 * A localStorage for Node.
 *
 * zustand's `persist` reads storage while the module is being evaluated, so
 * this has to be in place before `lib/workspace` is imported. Keeping it in its
 * own module means a plain static import ordered above that one does the job,
 * rather than a top-level `await import`.
 */

const entries = new Map<string, string>();

const shim: Storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, String(value)),
    removeItem: (key) => void entries.delete(key),
    clear: () => entries.clear(),
    key: (index) => [...entries.keys()][index] ?? null,
    get length() {
        return entries.size;
    },
};

(globalThis as { localStorage?: Storage }).localStorage ??= shim;
