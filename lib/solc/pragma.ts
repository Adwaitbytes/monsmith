/**
 * Works out which compiler a source file is asking for.
 *
 * Remix makes you pick the version from a dropdown, which means the first thing
 * anyone does with an unfamiliar contract is guess, fail, read the error, and
 * guess again. The pragma already says what it needs, so nothing should have to
 * be chosen: parse it, resolve it against the published releases, take the
 * newest version that satisfies every constraint.
 *
 * Deliberately not a general semver implementation. Solidity's pragma grammar
 * is a small subset, the version space is three numeric components with no
 * prerelease tags, and depending on a transitive copy of `semver` for this
 * would be a worse trade than forty lines that are exactly right.
 */

export interface VersionRange {
    operator: "=" | "^" | "~" | ">" | ">=" | "<" | "<=";
    major: number;
    minor: number;
    patch: number;
    /** True when the pragma omitted a component, as in `^0.8`. */
    partial: boolean;
}

export interface PragmaResolution {
    /** Every constraint found, in source order. */
    ranges: VersionRange[];
    /** The raw pragma text, for reporting. */
    text: string | null;
}

const PRAGMA = /pragma\s+solidity\s+([^;]+);/g;
const CONSTRAINT = /(>=|<=|\^|~|>|<|=)?\s*v?(\d+)\.(\d+)(?:\.(\d+))?/g;

/**
 * Reads every `pragma solidity` in a source unit.
 *
 * A flattened file carries one pragma per original file and they need not
 * agree. Every constraint is collected and the resolved version must satisfy
 * all of them, which is what solc itself requires of a compilation unit.
 */
export function parsePragmas(source: string): PragmaResolution {
    const ranges: VersionRange[] = [];
    const texts: string[] = [];

    for (const match of source.matchAll(PRAGMA)) {
        const body = match[1].trim();
        texts.push(body);

        for (const part of body.matchAll(CONSTRAINT)) {
            const [, operator, major, minor, patch] = part;
            ranges.push({
                operator: (operator as VersionRange["operator"]) ?? "=",
                major: Number(major),
                minor: Number(minor),
                patch: patch === undefined ? 0 : Number(patch),
                partial: patch === undefined,
            });
        }
    }

    return { ranges, text: texts.length > 0 ? [...new Set(texts)].join(", ") : null };
}

function cmp(a: [number, number, number], b: [number, number, number]): number {
    for (let i = 0; i < 3; i += 1) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
}

/** Whether a concrete version satisfies one constraint. */
export function satisfiesRange(version: string, range: VersionRange): boolean {
    const parts = version.split(".").map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) return false;
    const v: [number, number, number] = [parts[0], parts[1], parts[2]];
    const r: [number, number, number] = [range.major, range.minor, range.patch];

    switch (range.operator) {
        case "=":
            // `pragma solidity 0.8` without a patch means any 0.8.x.
            return range.partial ? v[0] === r[0] && v[1] === r[1] : cmp(v, r) === 0;
        case "^":
            // Solidity's caret does not widen across a minor below 1.0.0: ^0.8.1
            // allows 0.8.x and never 0.9.0.
            return v[0] === r[0] && v[1] === r[1] && v[2] >= r[2];
        case "~":
            return v[0] === r[0] && v[1] === r[1] && v[2] >= r[2];
        case ">":
            return cmp(v, r) > 0;
        case ">=":
            return cmp(v, r) >= 0;
        case "<":
            return cmp(v, r) < 0;
        case "<=":
            return cmp(v, r) <= 0;
        default:
            return false;
    }
}

export function satisfiesAll(version: string, ranges: readonly VersionRange[]): boolean {
    return ranges.every((range) => satisfiesRange(version, range));
}

export interface VersionChoice {
    /** Bare version chosen, e.g. `0.7.6`. Null when nothing satisfies the pragma. */
    version: string | null;
    /** Why this version, in words, for the report. */
    reason: string;
    pragma: string | null;
}

/**
 * Picks the newest released version satisfying the source's pragma.
 *
 * Newest rather than oldest on purpose: within a pragma's allowed range the
 * later compiler has the bug fixes, and a contract that pins `^0.8.0` was
 * written expecting to move forward. A contract that wanted one exact compiler
 * says `=`, and then there is only one answer anyway.
 */
export function chooseVersion(
    source: string,
    available: readonly string[],
    bundled: string,
): VersionChoice {
    const { ranges, text } = parsePragmas(source);

    if (ranges.length === 0) {
        return {
            version: bundled,
            reason: `No version pragma found, so the bundled compiler ${bundled} was used.`,
            pragma: null,
        };
    }

    // The bundled compiler needs no download, so it wins any tie.
    if (satisfiesAll(bundled, ranges)) {
        return {
            version: bundled,
            reason: `Pragma ${text} is satisfied by the bundled compiler ${bundled}.`,
            pragma: text,
        };
    }

    const sorted = [...available].sort((a, b) => {
        const pa = a.split(".").map(Number);
        const pb = b.split(".").map(Number);
        return cmp([pb[0], pb[1], pb[2]], [pa[0], pa[1], pa[2]]);
    });

    const match = sorted.find((candidate) => satisfiesAll(candidate, ranges));
    if (match === undefined) {
        return {
            version: null,
            reason: `No released compiler satisfies ${text}.`,
            pragma: text,
        };
    }

    return {
        version: match,
        reason: `Pragma ${text} requires a different compiler, so ${match} was fetched.`,
        pragma: text,
    };
}
