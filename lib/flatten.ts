/**
 * Flattens a verified contract's files into one compilable document.
 *
 * Concatenating the files is not flattening, and the difference is the whole
 * point of this module. A verified Uniswap V3 pool arrives as 96 files, each
 * importing the others by relative path. Joined end to end, every one of those
 * `import './libraries/Tick.sol'` lines survives into a single document where
 * no such path exists, so the compiler rejects it with one "Source not found"
 * per import before it reads a line of Solidity. The previous behaviour did
 * exactly that, which made importing any multi-file contract produce a file
 * that could not be compiled.
 *
 * Flattening means removing what a single document cannot have: the imports,
 * because everything they refer to is now in the same file; the repeated SPDX
 * identifiers, because solc refuses a file that declares more than one licence;
 * and the repeated pragmas, which are per-file in the original and per-document
 * here.
 *
 * Duplicates have to go too, and comparing content is not enough to find them.
 * A verified project routinely lists the same file under several paths, because
 * one import wrote `./contracts/Tick.sol` and another wrote
 * `contracts/@uniswap/v3-core/contracts/Tick.sol`. Separate paths are separate
 * compilation units and the compiler is happy; collapsed into one document they
 * become the same declaration twice. In Uniswap V3, `library Tick` arrives
 * three times and two of those copies differ by 189 bytes of comments, so
 * hashing the bodies misses them. Deduplication is therefore by declared
 * identifier: a file whose every top-level declaration has already been emitted
 * is another copy of a file already included, whatever its bytes say.
 *
 * Order matters, which is the one thing that is different inside a single file.
 * Across files the imports establish the order and a contract may inherit from
 * a base declared anywhere. In one document Solidity requires the base to
 * precede the derived contract, so the files have to be emitted in dependency
 * order. That order comes from the import graph, read before the imports are
 * stripped, which is the only reason they are parsed rather than simply deleted.
 */

/** Matches every import form the language allows. */
const IMPORT = /^\s*import\s+(?:[^;'"]*\s+from\s+)?["'][^"']+["']\s*;/gm;
/**
 * Top-level type declarations. Only the three that cannot nest, which is enough
 * to recognise a duplicated file and avoids matching a struct inside a contract.
 */
const DECLARATION = /^\s*(?:abstract\s+)?(?:contract|library|interface)\s+(\w+)/gm;
/** Captures the path from any import form, for building the dependency graph. */
const IMPORT_PATH = /^\s*import\s+(?:[^;'"]*\s+from\s+)?["']([^"']+)["']\s*;/gm;
const SPDX = /^\s*\/\/\s*SPDX-License-Identifier:\s*(.+)$/gm;
const PRAGMA = /^\s*pragma\s+([^;]+);/gm;

export interface FlattenResult {
    source: string;
    /** Licence kept for the document, when the files declared one. */
    license: string | null;
    /** Every distinct pragma kept, in the order first seen. */
    pragmas: string[];
    fileCount: number;
    /** Name of the contract the primary file declares, when there is one. */
    primaryContract: string | null;
    /** Files skipped because their declarations were already included. */
    duplicatesDropped: number;
    /** Licences that were dropped because a document may declare only one. */
    discardedLicenses: string[];
}

/**
 * Removes the directives that only make sense per file, returning the body.
 */
function stripDirectives(source: string): {
    body: string;
    license: string | null;
    pragmas: string[];
} {
    let license: string | null = null;
    const pragmas: string[] = [];

    let body = source.replace(SPDX, (_match, value: string) => {
        if (license === null) license = value.trim();
        return "";
    });

    body = body.replace(PRAGMA, (_match, value: string) => {
        pragmas.push(`pragma ${value.trim()};`);
        return "";
    });

    body = body.replace(IMPORT, "");

    return { body, license, pragmas };
}

/** The header the old concatenating importer wrote before each file. */
const FILE_MARKER = /^\/\/ File: (.+)$/gm;

/**
 * Recovers a file map from a document the old importer produced.
 *
 * Before flattening existed, importing a multi-file contract wrote every file
 * end to end with a `// File: path` header and left the imports in place. Those
 * documents are saved in people's projects and will not compile, and telling
 * someone to import again is a worse answer than repairing what they have. The
 * header makes the shape recognisable, so the map can be rebuilt and flattened
 * properly.
 *
 * Returns null for anything that is not that shape, including a correctly
 * flattened document, which has the same headers but no imports left to fail on.
 */
export function recoverFileMap(source: string): Map<string, string> | null {
    const markers = [...source.matchAll(FILE_MARKER)];
    if (markers.length < 2) return null;

    // Only worth recovering when there is something actually broken.
    const hasRelativeImport = /^\s*import\s+(?:[^;'"]*\s+from\s+)?["']\.[^"']*["']\s*;/m.test(
        source,
    );
    if (!hasRelativeImport) return null;

    const files = new Map<string, string>();
    for (let i = 0; i < markers.length; i += 1) {
        const marker = markers[i];
        const start = (marker.index ?? 0) + marker[0].length;
        const end = i + 1 < markers.length ? (markers[i + 1].index ?? source.length) : source.length;
        const path = marker[1].trim();
        if (path.length > 0) files.set(path, source.slice(start, end).trim());
    }

    return files.size > 1 ? files : null;
}

/**
 * Flattens a document that was concatenated rather than flattened, or returns
 * it unchanged when there is nothing to repair.
 */
export function repairConcatenated(source: string): string {
    const files = recoverFileMap(source);
    if (files === null) return source;

    // The last section is the contract the document was assembled for under the
    // old scheme, which put the primary first; either way the flattener will
    // order by dependency, so only the primary hint differs.
    const primary = [...files.keys()][0];
    return flattenSources(files, primary).source;
}

/** Normalises a relative import against the importing file's directory. */
function resolveImport(fromPath: string, importPath: string): string {
    if (!importPath.startsWith(".")) return importPath;

    const segments = fromPath.split("/").slice(0, -1);
    for (const part of importPath.split("/")) {
        if (part === "." || part === "") continue;
        if (part === "..") segments.pop();
        else segments.push(part);
    }
    return segments.join("/");
}

/** The map key an import refers to, matched loosely enough to survive path style. */
function matchKey(files: Map<string, string>, target: string): string | null {
    if (files.has(target)) return target;
    for (const key of files.keys()) {
        if (key === target || key.endsWith(`/${target}`) || target.endsWith(`/${key}`)) return key;
    }
    return null;
}

/**
 * Files in dependency order: everything a file imports comes before it.
 *
 * Depth-first post-order over the import graph. Cycles are possible in Solidity
 * through interfaces and are simply not revisited, which leaves the order
 * undefined among the cycle's members and correct everywhere else.
 */
function dependencyOrder(files: Map<string, string>): string[] {
    const ordered: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (path: string): void => {
        if (visited.has(path) || visiting.has(path)) return;
        visiting.add(path);

        const content = files.get(path) ?? "";
        for (const match of content.matchAll(IMPORT_PATH)) {
            const key = matchKey(files, resolveImport(path, match[1]));
            if (key !== null && key !== path) visit(key);
        }

        visiting.delete(path);
        visited.add(path);
        ordered.push(path);
    };

    for (const path of files.keys()) visit(path);
    return ordered;
}

/**
 * Combines a file map into one document.
 *
 * `primaryPath` is emitted last rather than first: it is the contract under
 * analysis, so everything else is one of its dependencies and has to precede it.
 */
export function flattenSources(
    files: Map<string, string>,
    primaryPath?: string,
): FlattenResult {
    if (files.size === 0) {
        return {
            source: "",
            license: null,
            pragmas: [],
            fileCount: 0,
            primaryContract: null,
            duplicatesDropped: 0,
            discardedLicenses: [],
        };
    }

    const hasPrimary = primaryPath !== undefined && files.has(primaryPath);

    // Duplicates are resolved before ordering, with the primary considered
    // first. Otherwise a copy of the primary under another path is kept and the
    // primary itself is dropped as the duplicate, which silently removes the
    // one contract the whole document exists for.
    const keptFiles = new Map<string, string>();
    const claimed = new Set<string>();
    const dedupOrder = hasPrimary
        ? [primaryPath as string, ...[...files.keys()].filter((path) => path !== primaryPath)]
        : [...files.keys()];

    let duplicatesDropped = 0;
    for (const path of dedupOrder) {
        const content = files.get(path) ?? "";
        const declared = [...content.matchAll(DECLARATION)].map((match) => match[1]);
        if (declared.length > 0 && declared.every((name) => claimed.has(name))) {
            duplicatesDropped += 1;
            continue;
        }
        for (const name of declared) claimed.add(name);
        keptFiles.set(path, content);
    }

    const sorted = dependencyOrder(keptFiles);
    const ordered = hasPrimary
        ? [...sorted.filter((path) => path !== primaryPath), primaryPath as string]
        : sorted;

    let license: string | null = null;
    const discarded = new Set<string>();
    const pragmas: string[] = [];
    const seenPragmas = new Set<string>();
    const bodies: string[] = [];

    for (const path of ordered) {
        const original = keptFiles.get(path) ?? "";
        const stripped = stripDirectives(original);

        if (stripped.license !== null) {
            if (license === null) license = stripped.license;
            else if (stripped.license !== license) discarded.add(stripped.license);
        }

        for (const pragma of stripped.pragmas) {
            // `pragma solidity` appears in every file and they need not agree;
            // keeping each distinct one lets the compiler resolve the
            // intersection exactly as it would have across the real files.
            if (seenPragmas.has(pragma)) continue;
            seenPragmas.add(pragma);
            pragmas.push(pragma);
        }

        const body = stripped.body.replace(/^\s*\n+/, "").trimEnd();
        if (body.length === 0) continue;

        bodies.push(`// File: ${path}\n${body}`);
    }

    const header: string[] = [];
    if (license !== null) header.push(`// SPDX-License-Identifier: ${license}`);
    header.push(...pragmas);

    return {
        source: `${header.join("\n")}\n\n${bodies.join("\n\n")}\n`,
        license,
        pragmas,
        fileCount: files.size,
        primaryContract: hasPrimary
            ? ([...(keptFiles.get(primaryPath as string) ?? "").matchAll(DECLARATION)]
                  .map((match) => match[1])
                  .pop() ?? null)
            : null,
        duplicatesDropped,
        discardedLicenses: [...discarded],
    };
}

/**
 * One contract and everything it imports, as a single compilable document.
 *
 * The report measures one contract at a time and the compiler is handed one
 * source, so a contract that imports its siblings used to fail gas and chain fit
 * with "imports files that are not here" even when every one of those files was
 * in the workspace. Uniswap V2's pair is the everyday example. Walking the
 * import graph from the contract and flattening only what it reaches gives the
 * compiler the whole unit without dragging in unrelated files that might not
 * compile together. Null when the contract imports nothing it can find, so the
 * caller keeps the source it already had.
 */
export function flattenImportClosure(primaryPath: string, files: Readonly<Record<string, string>>): string | null {
    const reached = importClosure(primaryPath, files);
    if (reached.size <= 1) return null;
    return flattenSources(reached, primaryPath).source;
}

/** The primary file and every file it reaches through imports, primary first. */
export function importClosure(primaryPath: string, files: Readonly<Record<string, string>>): Map<string, string> {
    const all = new Map(Object.entries(files));
    const reached = new Map<string, string>();
    const visit = (path: string): void => {
        if (reached.has(path)) return;
        const content = all.get(path);
        if (content === undefined) return;
        reached.set(path, content);
        for (const match of content.matchAll(IMPORT_PATH)) {
            const key = matchKey(all, resolveImport(path, match[1]));
            if (key !== null) visit(key);
        }
    };
    visit(primaryPath);
    return reached;
}
