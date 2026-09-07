import { create } from "zustand";

/**
 * Results of the studio's analysis panels, held outside the panels themselves.
 *
 * Every panel docks to the right of the editor and only one can be open, so
 * opening the gas profiler unmounts the parallel profiler. With the result in
 * component state that unmount threw the analysis away, and coming back showed
 * an empty panel and a button, as though nothing had ever been run. Moving the
 * results here makes switching panels free.
 *
 * Each entry records the source it was computed from. That is the part that
 * matters: a cached result shown against edited code is worse than no result,
 * because it looks current. So the entry is kept and marked stale rather than
 * silently dropped, and the panel says the source has changed and offers to run
 * again. The reader decides whether the old numbers still mean anything.
 *
 * Deliberately in memory rather than in localStorage. A Chain Fit report is
 * tens of kilobytes and the analyses take a second or two to reproduce, so
 * persisting them across reloads would trade a real risk of showing stale
 * numbers for very little.
 */

export type AnalysisKind = "parallel" | "gas" | "chainFit" | "security" | "migration";

export interface AnalysisEntry<T> {
    result: T;
    /** Fingerprint of the source this was computed from. */
    sourceKey: string;
    /** Which contract in the file, when the panel lets you choose. */
    contract?: string;
    at: number;
}

interface AnalysisState {
    entries: Partial<Record<AnalysisKind, AnalysisEntry<unknown>>>;
    save: (kind: AnalysisKind, sourceKey: string, result: unknown, contract?: string) => void;
    clear: (kind: AnalysisKind) => void;
    clearAll: () => void;
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
    entries: {},
    save: (kind, sourceKey, result, contract) =>
        set((state) => ({
            entries: {
                ...state.entries,
                [kind]: { result, sourceKey, contract, at: Date.now() },
            },
        })),
    clear: (kind) =>
        set((state) => {
            const entries = { ...state.entries };
            delete entries[kind];
            return { entries };
        }),
    clearAll: () => set({ entries: {} }),
}));

/**
 * Fingerprint of a source file.
 *
 * djb2 over the whole string. Cheap enough to run on every render, and the only
 * question asked of it is "is this the same text as before", where a collision
 * costs a stale badge rather than a wrong number.
 */
export function sourceKeyOf(source: string): string {
    let hash = 5381;
    for (let i = 0; i < source.length; i += 1) {
        hash = ((hash << 5) + hash + source.charCodeAt(i)) | 0;
    }
    return `${source.length.toString(36)}:${(hash >>> 0).toString(36)}`;
}

export interface CachedAnalysis<T> {
    /** The stored result, whether or not it still matches the editor. */
    result: T | null;
    /** True when the source has changed since this result was produced. */
    stale: boolean;
    at: number | null;
    contract: string | undefined;
}

/**
 * Reads one panel's cached result and reports whether it still matches the
 * editor. Panels use this instead of holding the result themselves.
 */
export function useCachedAnalysis<T>(kind: AnalysisKind, sourceKey: string): CachedAnalysis<T> {
    const entry = useAnalysisStore((state) => state.entries[kind]) as
        | AnalysisEntry<T>
        | undefined;

    if (entry === undefined) {
        return { result: null, stale: false, at: null, contract: undefined };
    }

    return {
        result: entry.result,
        stale: entry.sourceKey !== sourceKey,
        at: entry.at,
        contract: entry.contract,
    };
}
