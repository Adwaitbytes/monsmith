/**
 * Library linking.
 *
 * A library with `public` or `external` functions is deployed as its own
 * contract, and every contract calling it holds a DELEGATECALL to an address
 * the compiler cannot know. So solc leaves a 20-byte hole in the bytecode,
 * writes `__$<keccak of the library's fully qualified name>$__` into it, and
 * reports where the holes are in `linkReferences`.
 *
 * Deploying that bytecode unchanged puts the literal placeholder on chain,
 * where those bytes are read as instructions. It does not fail loudly: it
 * deploys something that is not the contract. The holes have to be filled with
 * the library's real address first, which means deploying the library before
 * the contract that uses it.
 */

export interface LinkReference {
    start: number;
    length: number;
}

/** solc's shape: source file, then library name, then the holes to fill. */
export type LinkReferences = Record<string, Record<string, LinkReference[]>>;

/** A library that must be on chain before the contract referencing it. */
export interface LibraryRequirement {
    /** As solc names it in the output, `contracts/Math.sol:BigMath`. */
    qualified: string;
    file: string;
    name: string;
    positions: LinkReference[];
}

const PLACEHOLDER = /__\$[0-9a-fA-F]{34}\$__|__[^_]{1,36}__/;

/** Whether any hole is left, including ones no linkReferences entry describes. */
export function hasUnlinkedPlaceholder(bytecode: string): boolean {
    return PLACEHOLDER.test(bytecode);
}

/** Flattens solc's nested linkReferences into one library per entry. */
export function librariesRequired(references: LinkReferences | undefined): LibraryRequirement[] {
    if (references === undefined) return [];

    const required: LibraryRequirement[] = [];
    for (const [file, byName] of Object.entries(references)) {
        for (const [name, positions] of Object.entries(byName)) {
            required.push({ qualified: `${file}:${name}`, file, name, positions });
        }
    }
    return required;
}

/**
 * Writes deployed library addresses into the holes.
 *
 * Patched by offset rather than by replacing the placeholder text, because
 * `linkReferences` is the compiler's own record of where the holes are and a
 * textual match could land on a byte sequence that merely looks like one.
 * Offsets are in bytes and the bytecode is hex, so every one doubles.
 */
export function linkBytecode(
    bytecode: string,
    references: LinkReferences | undefined,
    addresses: Record<string, string>,
): string {
    const prefixed = bytecode.startsWith("0x");
    const body = prefixed ? bytecode.slice(2) : bytecode;
    const chars = body.split("");

    for (const library of librariesRequired(references)) {
        const address = addresses[library.qualified] ?? addresses[library.name];
        if (address === undefined) {
            throw new Error(`No address to link for library ${library.name}.`);
        }

        const hex = address.replace(/^0x/, "").toLowerCase();
        if (!/^[0-9a-f]{40}$/.test(hex)) {
            throw new Error(`Cannot link ${library.name}: "${address}" is not an address.`);
        }

        for (const { start, length } of library.positions) {
            if (length !== 20) {
                throw new Error(`Unexpected ${length}-byte link slot for ${library.name}.`);
            }
            for (let i = 0; i < 40; i += 1) chars[start * 2 + i] = hex[i];
        }
    }

    const linked = chars.join("");
    if (hasUnlinkedPlaceholder(linked)) {
        throw new Error("Bytecode still contains an unlinked library placeholder after linking.");
    }

    return prefixed ? `0x${linked}` : linked;
}

/**
 * Orders libraries so each is deployed after anything it depends on.
 *
 * A library may use another library, so its own bytecode can have holes too.
 * Deploying in dependency order means every address is known by the time it is
 * needed, and a cycle is reported rather than looped on.
 */
export function deploymentOrder(
    libraries: Record<string, { linkReferences?: LinkReferences }>,
): string[] {
    const order: string[] = [];
    const state = new Map<string, "visiting" | "done">();

    const visit = (qualified: string, trail: string[]): void => {
        const seen = state.get(qualified);
        if (seen === "done") return;
        if (seen === "visiting") {
            throw new Error(`Libraries depend on each other in a cycle: ${[...trail, qualified].join(" -> ")}`);
        }

        state.set(qualified, "visiting");
        for (const dependency of librariesRequired(libraries[qualified]?.linkReferences)) {
            if (libraries[dependency.qualified] !== undefined) {
                visit(dependency.qualified, [...trail, qualified]);
            }
        }
        state.set(qualified, "done");
        order.push(qualified);
    };

    for (const qualified of Object.keys(libraries)) visit(qualified, []);
    return order;
}
