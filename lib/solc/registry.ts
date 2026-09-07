import "server-only";

import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { keccak256 } from "viem";

/**
 * A require bound to the project root.
 *
 * Seeded from cwd rather than `import.meta.url` so the module still typechecks
 * under a CommonJS target, and used instead of a bare `require` so the bundler
 * does not try to statically resolve a path that only exists at runtime.
 */
const projectRequire = createRequire(path.join(process.cwd(), "package.json"));

/**
 * Loads whichever Solidity compiler a contract actually needs.
 *
 * The studio bundles one compiler, 0.8.31, and that is the wrong version for a
 * large part of the ecosystem worth analysing: Uniswap V3 is pinned to =0.7.6,
 * Uniswap V2 to 0.5.16, and most DeFi written before 2021 is on 0.6 or 0.7. A
 * tool that cannot read those contracts cannot say anything about them.
 *
 * Three things make this more than a download.
 *
 * Integrity. Every release in the official list publishes the keccak256 of its
 * binary. We fetch, hash, and refuse to load anything that does not match, so a
 * compromised mirror cannot hand us a compiler that emits whatever it likes.
 * The alternative is executing 24 MB of unverified JavaScript fetched at
 * request time, which is not a thing to do quietly.
 *
 * Caching at two levels. Instances are reused between requests, so a compiler
 * stays in memory once loaded; and the binary is written to the OS temp
 * directory, so a cold start on a warm machine re-reads rather than re-fetches.
 * A download is 24 MB and about three seconds; a disk read is about a hundred
 * milliseconds.
 *
 * Single flight. Two requests for the same uncached version would otherwise
 * both download it. They share one promise instead.
 */

const LIST_URL = "https://binaries.soliditylang.org/bin/list.json";
const BIN_BASE = "https://binaries.soliditylang.org/bin";

/** How many compiler instances to hold in memory. Each is hundreds of MB resident. */
const MEMORY_LIMIT = 2;
/** How many binaries to keep on disk. Each is roughly 24 MB. */
const DISK_LIMIT = 6;

const LIST_TTL_MS = 6 * 60 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

export interface SolcBuild {
    /** File name, e.g. `soljson-v0.7.6+commit.7338295f.js`. */
    path: string;
    /** Bare version, e.g. `0.7.6`. */
    version: string;
    /** Version with commit, e.g. `0.7.6+commit.7338295f`. */
    longVersion: string;
    keccak256: string;
    sha256?: string;
}

interface ReleaseList {
    builds: SolcBuild[];
    /** Bare version to file name. Only release builds, never nightlies. */
    releases: Record<string, string>;
    latestRelease: string;
}

/** The compiler compiled into the bundle, always available with no network. */
export const BUNDLED_VERSION: string = (() => {
    try {
        return (projectRequire("solc") as { version(): string }).version();
    } catch {
        return "0.8.31";
    }
})();

export function bundledShortVersion(): string {
    return BUNDLED_VERSION.split("+")[0];
}

// ============= RELEASE LIST =============

let listCache: { at: number; list: ReleaseList } | null = null;
let listInFlight: Promise<ReleaseList> | null = null;

export async function fetchReleaseList(): Promise<ReleaseList> {
    if (listCache !== null && Date.now() - listCache.at < LIST_TTL_MS) return listCache.list;
    if (listInFlight !== null) return listInFlight;

    listInFlight = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        try {
            const response = await fetch(LIST_URL, { signal: controller.signal });
            if (!response.ok) throw new Error(`compiler list unavailable (HTTP ${response.status})`);
            const list = (await response.json()) as ReleaseList;
            if (!Array.isArray(list.builds) || typeof list.releases !== "object") {
                throw new Error("compiler list is malformed");
            }
            listCache = { at: Date.now(), list };
            return list;
        } finally {
            clearTimeout(timer);
            listInFlight = null;
        }
    })();

    return listInFlight;
}

/**
 * Release builds only, newest first.
 *
 * `builds` also contains thousands of nightlies, and a nightly is not a version
 * anyone pins to. `releases` is the map of what was actually released.
 */
export async function releaseBuilds(): Promise<SolcBuild[]> {
    const list = await fetchReleaseList();
    const releasePaths = new Set(Object.values(list.releases));
    return list.builds
        .filter((build) => releasePaths.has(build.path))
        .sort((a, b) => compareVersions(b.version, a.version));
}

export function compareVersions(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i += 1) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

// ============= LOADING =============

interface LoadedSolc {
    version: string;
    longVersion: string;
    compile(input: string, options?: unknown): string;
}

const memory = new Map<string, LoadedSolc>();
const inFlight = new Map<string, Promise<LoadedSolc>>();

function cacheDir(): string {
    return path.join(os.tmpdir(), "monsmith-solc");
}

/**
 * keccak256 of a binary, matching the `keccak256` field the release list
 * publishes for every build. Node's crypto offers SHA3-256 rather than
 * Ethereum's keccak256 and the two pad differently, so this uses viem's.
 */
function digestOf(buffer: Buffer): string {
    return keccak256(new Uint8Array(buffer));
}

async function readCached(file: string, expected: string): Promise<Buffer | null> {
    try {
        const buffer = await fs.readFile(file);
        // A truncated or tampered cache entry is worse than a cache miss.
        if (digestOf(buffer) !== expected) {
            await fs.rm(file, { force: true });
            return null;
        }
        return buffer;
    } catch {
        return null;
    }
}

async function pruneDisk(): Promise<void> {
    try {
        const dir = cacheDir();
        const entries = await fs.readdir(dir);
        if (entries.length <= DISK_LIMIT) return;

        const stats = await Promise.all(
            entries.map(async (name) => {
                const file = path.join(dir, name);
                const stat = await fs.stat(file);
                return { file, atime: stat.atimeMs };
            }),
        );
        stats.sort((a, b) => a.atime - b.atime);
        for (const { file } of stats.slice(0, stats.length - DISK_LIMIT)) {
            await fs.rm(file, { force: true });
        }
    } catch {
        // Pruning is housekeeping. Failing it must not fail a compile.
    }
}

/** Loads a specific compiler build, fetching and verifying it if necessary. */
export async function loadSolc(build: SolcBuild): Promise<LoadedSolc> {
    const key = build.longVersion;

    const cached = memory.get(key);
    if (cached !== undefined) {
        // Refresh recency for the LRU.
        memory.delete(key);
        memory.set(key, cached);
        return cached;
    }

    const existing = inFlight.get(key);
    if (existing !== undefined) return existing;

    const load = (async (): Promise<LoadedSolc> => {
        const dir = cacheDir();
        await fs.mkdir(dir, { recursive: true });
        const file = path.join(dir, build.path);

        const expected = build.keccak256;
        let buffer = await readCached(file, expected);

        if (buffer === null) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
            try {
                const response = await fetch(`${BIN_BASE}/${build.path}`, { signal: controller.signal });
                if (!response.ok) {
                    throw new Error(`could not download solc ${build.version} (HTTP ${response.status})`);
                }
                buffer = Buffer.from(await response.arrayBuffer());
            } finally {
                clearTimeout(timer);
            }

            if (digestOf(buffer) !== expected) {
                throw new Error(
                    `solc ${build.version} failed its integrity check and was not loaded`,
                );
            }

            await fs.writeFile(file, buffer);
            void pruneDisk();
        }

        // The bundler must not see these: the binary path only exists at
        // runtime, and a static import would make webpack try to resolve it.
        const wrapper = projectRequire("solc/wrapper.js") as (mod: unknown) => LoadedSolc;
        const soljson = projectRequire(file);
        const instance = wrapper(soljson);

        memory.set(key, instance);
        while (memory.size > MEMORY_LIMIT) {
            const oldest = memory.keys().next().value;
            if (oldest === undefined) break;
            memory.delete(oldest);
        }

        return instance;
    })();

    inFlight.set(key, load);
    try {
        return await load;
    } finally {
        inFlight.delete(key);
    }
}

/** Finds the release build for an exact version, long or short. */
export async function findBuild(version: string): Promise<SolcBuild | null> {
    const builds = await releaseBuilds();
    const wanted = version.replace(/^v/, "");
    return (
        builds.find((build) => build.longVersion === wanted) ??
        builds.find((build) => build.version === wanted) ??
        null
    );
}
