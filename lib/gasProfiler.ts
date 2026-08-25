import type { CompileOutput } from "./solc";

/**
 * Turns solc's raw `evm.gasEstimates` into something a developer can act on.
 *
 * solc reports a per-function upper bound derived from the control flow graph.
 * When a function contains a loop whose trip count is not statically known it
 * reports the string "infinite" rather than a number, which is a fact about the
 * analysis rather than about the gas: the function is unbounded from solc's
 * point of view. Both cases are surfaced, never coerced to a number.
 */

/** Execution-gas bands. Chosen to match how a developer reasons about cost. */
export const CHEAP_MAX_GAS = 30_000;
export const MODERATE_MAX_GAS = 80_000;

/** EIP-170 runtime code limit. Deploying above it reverts. */
export const CONTRACT_SIZE_LIMIT_BYTES = 24_576;

export type GasClass = 'cheap' | 'moderate' | 'expensive' | 'unbounded';

export interface FunctionGas {
    /** Canonical signature, e.g. `transfer(address,uint256)`. */
    signature: string;
    name: string;
    /** null when solc reported "infinite". */
    gas: number | null;
    classification: GasClass;
    stateMutability: string | null;
    /** Concrete next step, present only for expensive and unbounded functions. */
    hint: string | null;
}

export interface DeploymentGas {
    codeDepositCost: number | null;
    executionCost: number | null;
    totalCost: number | null;
    /** True when solc could not bound the constructor. */
    unbounded: boolean;
}

export interface GasSummary {
    totalFunctions: number;
    cheap: number;
    moderate: number;
    expensive: number;
    unbounded: number;
    /** Highest bounded estimate, so the UI can scale its bars. */
    maxGas: number;
}

export interface GasProfile {
    contractName: string;
    deployment: DeploymentGas;
    /** Public and external functions, most expensive first. Unbounded sort to the top. */
    functions: FunctionGas[];
    /** Internal and private functions, same ordering. */
    internalFunctions: FunctionGas[];
    /** Runtime code size, the figure EIP-170 limits. */
    contractSizeBytes: number;
    contractSizeLimitBytes: number;
    summary: GasSummary;
    warnings: string[];
}

/** Minimal view of an ABI entry. viem's `Abi` union is awkward to narrow field by field. */
interface AbiParam {
    type: string;
    components?: AbiParam[];
}

interface AbiEntry {
    type?: string;
    name?: string;
    inputs?: AbiParam[];
    outputs?: AbiParam[];
    stateMutability?: string;
}

/** "24000" -> 24000, "infinite" -> null, absent -> null. */
function parseGas(raw: string | undefined): number | null {
    if (raw === undefined || raw === 'infinite') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

function classify(gas: number | null): GasClass {
    if (gas === null) return 'unbounded';
    if (gas < CHEAP_MAX_GAS) return 'cheap';
    if (gas <= MODERATE_MAX_GAS) return 'moderate';
    return 'expensive';
}

/** Expands tuples so the signature matches the one solc keys its estimates by. */
function canonicalType(param: AbiParam): string {
    if (param.type.startsWith('tuple')) {
        const inner = (param.components ?? []).map(canonicalType).join(',');
        return `(${inner})${param.type.slice('tuple'.length)}`;
    }
    return param.type;
}

function isDynamic(param: AbiParam): boolean {
    if (param.type.endsWith('[]')) return true;
    if (param.type === 'string' || param.type === 'bytes') return true;
    if (param.type.startsWith('tuple')) return (param.components ?? []).some(isDynamic);
    return false;
}

/** Signature -> ABI entry, so estimates can be enriched with mutability and arity. */
function indexAbiBySignature(abi: CompileOutput['contract']['abi']): Map<string, AbiEntry> {
    const index = new Map<string, AbiEntry>();

    for (const entry of abi as unknown as AbiEntry[]) {
        if (entry.type !== 'function' || !entry.name) continue;
        const args = (entry.inputs ?? []).map(canonicalType).join(',');
        index.set(`${entry.name}(${args})`, entry);
    }

    return index;
}

/**
 * Pulls each function body out of the source by brace matching.
 *
 * Bodies are only used to explain a cost, never to compute one, so an
 * approximate parse is acceptable: a missed function degrades to a generic
 * hint rather than a wrong number.
 */
function extractFunctionBodies(sourceCode: string): Map<string, string> {
    const bodies = new Map<string, string>();
    const functionRegex = /function\s+(\w+)\s*\([^)]*\)[^{;]*\{/g;

    let match: RegExpExecArray | null;
    while ((match = functionRegex.exec(sourceCode)) !== null) {
        const bodyStart = sourceCode.indexOf('{', match.index);
        let depth = 1;
        let cursor = bodyStart + 1;

        while (depth > 0 && cursor < sourceCode.length) {
            if (sourceCode[cursor] === '{') depth++;
            else if (sourceCode[cursor] === '}') depth--;
            cursor++;
        }

        // A contract can declare the same name twice via overloads; keeping the
        // first is enough because hints are advisory.
        if (!bodies.has(match[1])) {
            bodies.set(match[1], sourceCode.slice(bodyStart, cursor));
        }
    }

    return bodies;
}

/** State variable names, used to tell a storage access from a local one. */
function extractStateVariableNames(sourceCode: string): Set<string> {
    const names = new Set<string>();
    const bodies = extractFunctionBodies(sourceCode);

    for (const line of sourceCode.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.includes('function ')) continue;

        const patterns = [
            /^(?:uint\d*|int\d*|address|bool|bytes\d*|string)(?:\[\])?\s+(?:public|private|internal|constant|immutable|payable\s)*\s*(\w+)\s*[=;]/,
            /^mapping\s*\(.+\)\s+(?:public|private|internal)?\s*(\w+)\s*;/,
            /^(\w+)(?:\[\])?\s+(?:public|private|internal)\s+(\w+)\s*[=;]/,
        ];

        for (const pattern of patterns) {
            const match = trimmed.match(pattern);
            if (!match) continue;
            const name = match[2] ?? match[1];
            // A declaration inside a function body is a local, not storage.
            const isLocal = [...bodies.values()].some((body) => body.includes(trimmed));
            if (name && !isLocal) names.add(name);
        }
    }

    return names;
}

/** Loop bodies inside a function, extracted by brace matching like the functions themselves. */
function extractLoops(body: string): { header: string; body: string }[] {
    const loops: { header: string; body: string }[] = [];
    const loopRegex = /\b(for|while)\s*\(([^)]*)\)\s*\{/g;

    let match: RegExpExecArray | null;
    while ((match = loopRegex.exec(body)) !== null) {
        const start = body.indexOf('{', match.index);
        let depth = 1;
        let cursor = start + 1;

        while (depth > 0 && cursor < body.length) {
            if (body[cursor] === '{') depth++;
            else if (body[cursor] === '}') depth--;
            cursor++;
        }

        loops.push({ header: match[2], body: body.slice(start, cursor) });
    }

    return loops;
}

function countStorageWrites(body: string, stateVars: Set<string>): number {
    let writes = 0;

    for (const name of stateVars) {
        // Matches `name =`, `name +=`, `name[key] =` and `name.field =`, but not `==`.
        const writeRegex = new RegExp(`\\b${name}\\b(?:\\[[^\\]]*\\]|\\.\\w+)*\\s*(?:\\+|-|\\*|\\/)?=(?!=)`, 'g');
        writes += (body.match(writeRegex) ?? []).length;
    }

    return writes;
}

function readsStorage(body: string, stateVars: Set<string>): string | null {
    for (const name of stateVars) {
        if (new RegExp(`\\b${name}\\b`).test(body)) return name;
    }
    return null;
}

const EXTERNAL_CALL_PATTERN = /\.call\s*\{|\.transferFrom\s*\(|\.transfer\s*\(|\.send\s*\(/;

/** Names the loop, if any, that best explains a cost. Shared by both bands. */
function loopHint(body: string, stateVars: Set<string>): string | null {
    const loops = extractLoops(body);
    if (loops.length === 0) return null;

    if (loops.some((loop) => /\.length/.test(loop.header))) {
        return 'unbounded loop over a dynamic array - cap the iteration count or paginate the work';
    }

    const withStorage = loops
        .map((loop) => readsStorage(loop.body, stateVars))
        .find((variable) => variable !== null);

    if (withStorage) {
        return `storage read of "${withStorage}" inside a loop - cache it in a memory variable before the loop`;
    }

    return 'loop bound depends on runtime data - enforce a maximum iteration count';
}

/**
 * Explains why solc gave up on bounding a function.
 *
 * The order reflects what actually defeats the estimator: an unbounded loop or
 * a call into unknown code, then data whose length is only known at runtime.
 * Counting storage writes would be misleading here - writes are bounded, so
 * they are never the reason the estimate is "infinite".
 */
function hintForUnbounded(entry: AbiEntry | undefined, body: string | undefined, stateVars: Set<string>): string {
    if (body) {
        const loop = loopHint(body, stateVars);
        if (loop) return loop;

        if (EXTERNAL_CALL_PATTERN.test(body)) {
            return 'external call in the hot path - the callee sets the real cost, so batch the calls or move them off this function';
        }
    }

    if ((entry?.outputs ?? []).some(isDynamic)) {
        return 'returns dynamic data (string, bytes or an array) so solc cannot bound the cost - the real gas scales with the returned length';
    }

    if ((entry?.inputs ?? []).some(isDynamic)) {
        return 'cost scales with the length of a dynamic argument - validate a maximum length before doing the work';
    }

    if (body) {
        if (/abi\.encodePacked\s*\(|abi\.encode\s*\(/.test(body)) {
            return 'hashes or encodes dynamically sized data - encode fixed-width values instead so the cost stops depending on input length';
        }

        return 'cost depends on runtime values, so solc could not bound it - measure this one on a fork before relying on a fixed gas limit';
    }

    return 'solc cannot bound this cost - it comes from inherited or data-dependent logic, so check the base contract for loops over dynamic data';
}

/** Explains a large but bounded estimate, where storage traffic usually dominates. */
function hintForExpensive(body: string | undefined, stateVars: Set<string>): string {
    if (!body) {
        return 'cost comes from an inherited implementation - check the base contract, or call this less often by batching';
    }

    const loop = loopHint(body, stateVars);
    if (loop) return loop;

    const writes = countStorageWrites(body, stateVars);
    if (writes >= 3) {
        return `${writes} storage writes - pack the related fields into one struct so they share a slot`;
    }

    if (EXTERNAL_CALL_PATTERN.test(body)) {
        return 'external call in the hot path - the callee sets the real cost, so batch the calls or move them off this function';
    }

    if (/\bnew\s+\w+\s*\(/.test(body)) {
        return 'deploys a contract on every call - deploy once and use a minimal proxy or a registry instead';
    }

    if (writes > 0) {
        return `${writes} storage write${writes === 1 ? '' : 's'} plus surrounding checks - see whether any stored value can be derived on read instead`;
    }

    return 'cost is dominated by storage and arithmetic in this function - look for values that can be computed once and reused';
}

/**
 * One actionable sentence for an expensive or unbounded estimate, or null when
 * the function is cheap enough not to need one.
 *
 * Source-derived reasons come first because they name the exact construct the
 * developer wrote. Functions inherited from OpenZeppelin have no body here, so
 * they fall through to the ABI-shaped and generic explanations.
 */
function buildHint(
    classification: GasClass,
    entry: AbiEntry | undefined,
    body: string | undefined,
    stateVars: Set<string>
): string | null {
    if (classification === 'unbounded') return hintForUnbounded(entry, body, stateVars);
    if (classification === 'expensive') return hintForExpensive(body, stateVars);
    return null;
}

function toFunctionGas(
    signature: string,
    raw: string,
    abiIndex: Map<string, AbiEntry>,
    bodies: Map<string, string>,
    stateVars: Set<string>
): FunctionGas {
    const gas = parseGas(raw);
    const classification = classify(gas);
    const name = signature.slice(0, signature.indexOf('('));
    const entry = abiIndex.get(signature);

    return {
        signature,
        name,
        gas,
        classification,
        stateMutability: entry?.stateMutability ?? null,
        hint: buildHint(classification, entry, bodies.get(name), stateVars),
    };
}

/** Unbounded first, then descending gas: the order a developer should read them in. */
function byCostDescending(a: FunctionGas, b: FunctionGas): number {
    if (a.gas === null && b.gas === null) return a.name.localeCompare(b.name);
    if (a.gas === null) return -1;
    if (b.gas === null) return 1;
    return b.gas - a.gas;
}

/** Builds the profile the API returns from a compile that requested `evm.gasEstimates`. */
export function buildGasProfile(sourceCode: string, compiled: CompileOutput): GasProfile {
    const { contract, contractName, warnings } = compiled;
    const estimates = contract.evm?.gasEstimates;

    const abiIndex = indexAbiBySignature(contract.abi);
    const bodies = extractFunctionBodies(sourceCode);
    const stateVars = extractStateVariableNames(sourceCode);

    const toList = (source: Record<string, string> | undefined): FunctionGas[] =>
        Object.entries(source ?? {})
            .map(([signature, raw]) => toFunctionGas(signature, raw, abiIndex, bodies, stateVars))
            .sort(byCostDescending);

    const functions = toList(estimates?.external);
    const internalFunctions = toList(estimates?.internal);

    const creationTotal = parseGas(estimates?.creation?.totalCost);
    const deployment: DeploymentGas = {
        codeDepositCost: parseGas(estimates?.creation?.codeDepositCost),
        executionCost: parseGas(estimates?.creation?.executionCost),
        totalCost: creationTotal,
        unbounded: estimates?.creation !== undefined && creationTotal === null,
    };

    // Runtime code is what EIP-170 caps; creation code is only ever transient.
    const runtimeCode = contract.evm?.deployedBytecode?.object ?? '';

    const boundedGas = functions.map((fn) => fn.gas).filter((gas): gas is number => gas !== null);

    return {
        contractName,
        deployment,
        functions,
        internalFunctions,
        contractSizeBytes: runtimeCode.replace(/^0x/, '').length / 2,
        contractSizeLimitBytes: CONTRACT_SIZE_LIMIT_BYTES,
        summary: {
            totalFunctions: functions.length,
            cheap: functions.filter((fn) => fn.classification === 'cheap').length,
            moderate: functions.filter((fn) => fn.classification === 'moderate').length,
            expensive: functions.filter((fn) => fn.classification === 'expensive').length,
            unbounded: functions.filter((fn) => fn.classification === 'unbounded').length,
            maxGas: boundedGas.length > 0 ? Math.max(...boundedGas) : 0,
        },
        warnings,
    };
}
