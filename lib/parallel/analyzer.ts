/**
 * Parallel execution analysis for Monad.
 *
 * Monad executes transactions optimistically in parallel and re-runs any that
 * touched state another transaction had already written. So the question this
 * answers is narrow and concrete: for two transactions drawn from this
 * contract's entrypoints, do their storage footprints overlap on a slot one of
 * them writes? Everything reported here is derived from that, rather than from
 * counting how many times a name appears in the file.
 */

import { lineCounter } from './source';
import { linearize, parseSolidity } from './parser';
import type { FunctionDef, StateVariable, UnitDef } from './parser';
import { resolveTransitiveEffects } from './effects';
import type { AccessScope, FunctionEffects, SlotEffect } from './effects';

export type { AccessScope, SlotEffect } from './effects';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type Contention = 'serial' | 'conditional' | 'independent';

export interface Entrypoint {
    name: string;
    signature: string;
    visibility: string;
    stateMutability: string;
    reads: SlotEffect[];
    writes: SlotEffect[];
    contention: Contention;
    canParallelize: boolean;
    /** Entrypoints this one always serialises against, itself included. */
    conflictsWith: string[];
    /** Entrypoints it only serialises against when they touch the same key. */
    contendsOnKeyWith: string[];
    /** Internal helpers whose effects are folded in, so the reader can follow it. */
    through: string[];
    reason: string;
    line: number;
}

export interface ReadOnlyFunction {
    name: string;
    signature: string;
    stateMutability: string;
}

export interface Hotspot {
    variable: string;
    typeText: string;
    scope: AccessScope;
    writers: string[];
    readers: string[];
    severity: 'high' | 'medium' | 'low';
    /** Entrypoint pairs this slot alone forces to serialise. */
    blockedPairs: number;
    /** True when every write builds on the previous value, so stripes would sum back. */
    accumulator: boolean;
    impact: string;
    line: number;
}

export interface ConflictPair {
    a: string;
    b: string;
    variables: string[];
    certainty: 'always' | 'same-key';
}

export interface OptimizationSuggestion {
    type: 'shard_counter' | 'storage_packing' | 'state_separation' | 'event_offload' | 'already_optimal';
    priority: 'high' | 'medium' | 'low';
    title: string;
    description: string;
    currentCode?: string;
    suggestedCode?: string;
    impact: string;
}

export interface ContractOption {
    name: string;
    entrypoints: number;
    kind: string;
}

export interface ParallelMetrics {
    pairsTotal: number;
    pairsBlocked: number;
    pairsConditional: number;
    pairsIndependent: number;
    globalSlots: number;
    keyedSlots: number;
    callerSlots: number;
}

export interface ParallelAnalysisResult {
    contract: string;
    availableContracts: ContractOption[];
    score: number;
    grade: Grade;
    headline: string;
    summary: string;
    totalFunctions: number;
    parallelizableFunctions: number;
    entrypoints: Entrypoint[];
    readOnlyFunctions: ReadOnlyFunction[];
    hotspots: Hotspot[];
    conflictPairs: ConflictPair[];
    suggestions: OptimizationSuggestion[];
    metrics: ParallelMetrics;
    notes: string[];
}

/** Ranks addressing modes by how much of the contract's traffic they collide with. */
const SCOPE_RANK: Record<AccessScope, number> = { caller: 0, keyed: 1, global: 2 };

/** A key-dependent overlap costs little in practice, but it is not free. */
const CONDITIONAL_WEIGHT = 0.85;

export function analyzeParallelPotential(sourceCode: string, contractName?: string): ParallelAnalysisResult {
    const units = parseSolidity(sourceCode);
    const byName = new Map(units.map((unit) => [unit.name, unit]));

    const deployable = units.filter((unit) => unit.kind === 'contract' && !unit.abstract);
    const options: ContractOption[] = deployable.map((unit) => ({
        name: unit.name,
        kind: unit.kind,
        entrypoints: countEntrypoints(unit, byName),
    }));

    const target =
        (contractName ? deployable.find((unit) => unit.name === contractName) : undefined) ??
        pickPrimary(deployable, byName);

    if (!target) return emptyResult(options, contractName);

    const chain = linearize(target, byName);
    // Bases named in the source but absent from this file are imports we cannot
    // read. Their entrypoints and their storage are invisible here, so a score
    // computed without them has to say so rather than pass itself off as complete.
    const unresolvedBases = Array.from(
        new Set(chain.flatMap((unit) => unit.bases.filter((base) => !byName.has(base)))),
    );
    const storage = collectStorage(chain);
    const lineOfFor = lineOffsetResolver(sourceCode);
    const effects = resolveTransitiveEffects(chain, storage, lineOfFor);

    const callables = mostDerived(chain);
    const entrypointDefs = callables.filter(isEntrypoint);
    const readOnly = callables
        .filter((func) => func.kind === 'function'
            && (func.visibility === 'public' || func.visibility === 'external')
            && (func.stateMutability === 'view' || func.stateMutability === 'pure'))
        .map((func) => ({ name: func.name, signature: func.signature, stateMutability: func.stateMutability }));

    const entrypoints = buildEntrypoints(entrypointDefs, effects);

    // Nothing to schedule means nothing to score. Returning a perfect grade here
    // would be the worst possible answer: a contract whose entrypoints all come
    // from an imported base would read as ideally parallel when in fact none of
    // it was examined.
    if (entrypoints.length === 0) {
        return unscorableResult(target.name, options, unresolvedBases, readOnly);
    }

    const { conflictPairs, metrics, blockedByVariable } = pairInteractions(entrypoints, effects);

    applyContention(entrypoints, conflictPairs);

    const hotspots = buildHotspots(entrypoints, effects, storage, blockedByVariable);
    const { score, grade } = scoreFrom(metrics);
    const suggestions = buildSuggestions(hotspots, storage, entrypoints);
    const notes = buildNotes(hotspots, entrypoints);

    if (unresolvedBases.length > 0) {
        notes.unshift(
            `${unresolvedBases.join(', ')} ${unresolvedBases.length === 1 ? 'is' : 'are'} imported rather than ` +
            `declared in this file, so any entrypoint or state they add is outside this score.`,
        );
    }

    metrics.globalSlots = hotspots.filter((h) => h.scope === 'global').length;
    metrics.keyedSlots = hotspots.filter((h) => h.scope === 'keyed').length;
    metrics.callerSlots = hotspots.filter((h) => h.scope === 'caller').length;

    const parallelizableFunctions = entrypoints.filter((e) => e.canParallelize).length;

    return {
        contract: target.name,
        availableContracts: options,
        score,
        grade,
        headline: headlineFor(score, entrypoints.length, parallelizableFunctions),
        summary: summaryFor(score, entrypoints, hotspots, readOnly.length),
        totalFunctions: entrypoints.length,
        parallelizableFunctions,
        entrypoints,
        readOnlyFunctions: readOnly,
        hotspots,
        conflictPairs,
        suggestions,
        metrics,
        notes,
    };
}

/** Externally callable and state-changing: the transactions Monad has to schedule. */
function isEntrypoint(func: FunctionDef): boolean {
    if (func.kind === 'constructor' || func.kind === 'modifier') return false;
    if (func.visibility !== 'public' && func.visibility !== 'external') return false;
    return func.stateMutability !== 'view' && func.stateMutability !== 'pure';
}

function countEntrypoints(unit: UnitDef, byName: Map<string, UnitDef>): number {
    return mostDerived(linearize(unit, byName)).filter(isEntrypoint).length;
}

/**
 * A flattened file holds every dependency of the contract that matters. The one
 * worth profiling is the one that actually accepts transactions.
 */
function pickPrimary(deployable: UnitDef[], byName: Map<string, UnitDef>): UnitDef | undefined {
    let best: UnitDef | undefined;
    let bestCount = -1;

    for (const unit of deployable) {
        const count = countEntrypoints(unit, byName);
        // Ties go to the later declaration, which in a flattened file is the
        // contract everything above it was assembled for.
        if (count >= bestCount) {
            best = unit;
            bestCount = count;
        }
    }

    return best;
}

/** Overrides win, so a derived definition replaces its base by name. */
function mostDerived(chain: UnitDef[]): FunctionDef[] {
    const byName = new Map<string, FunctionDef>();
    for (const unit of chain) {
        for (const func of unit.functions) byName.set(func.name, func);
    }
    return [...byName.values()];
}

function collectStorage(chain: UnitDef[]): Map<string, StateVariable> {
    const storage = new Map<string, StateVariable>();
    for (const unit of chain) {
        for (const variable of unit.stateVariables) storage.set(variable.name, variable);
    }
    return storage;
}

/**
 * Maps a body-relative offset back to a file line.
 *
 * Bodies are sliced out of the source, so their own offsets mean nothing on
 * their own; each function carries the line its header started on.
 */
function lineOffsetResolver(sourceCode: string) {
    const lineOf = lineCounter(sourceCode);
    void lineOf;
    return (func: FunctionDef) => (offsetInBody: number) => {
        const newlinesBefore = (func.body.slice(0, offsetInBody).match(/\n/g) || []).length;
        return func.line + newlinesBefore;
    };
}

function buildEntrypoints(defs: FunctionDef[], effects: Map<string, FunctionEffects>): Entrypoint[] {
    return defs.map((func) => {
        const own = effects.get(func.name) ?? { reads: new Map(), writes: new Map(), through: [] };
        return {
            name: func.name,
            signature: func.signature,
            visibility: func.visibility,
            stateMutability: func.stateMutability,
            reads: [...own.reads.values()].sort(byScope),
            writes: [...own.writes.values()].sort(byScope),
            contention: 'independent' as Contention,
            canParallelize: true,
            conflictsWith: [],
            contendsOnKeyWith: [],
            through: own.through,
            reason: '',
            line: func.line,
        };
    });
}

function byScope(a: SlotEffect, b: SlotEffect): number {
    return SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope] || a.variable.localeCompare(b.variable);
}

/**
 * Compares every pair of entrypoints, self-pairs included.
 *
 * The self-pair is the one that matters most and the one the old analyser had
 * no concept of: a thousand users calling the same function that bumps one
 * counter serialise completely, however clean the rest of the contract is.
 */
function pairInteractions(
    entrypoints: Entrypoint[],
    effects: Map<string, FunctionEffects>
): { conflictPairs: ConflictPair[]; metrics: ParallelMetrics; blockedByVariable: Map<string, number> } {
    const conflictPairs: ConflictPair[] = [];
    const blockedByVariable = new Map<string, number>();
    let blocked = 0;
    let conditional = 0;
    let independent = 0;

    for (let i = 0; i < entrypoints.length; i++) {
        for (let j = i; j < entrypoints.length; j++) {
            const a = effects.get(entrypoints[i].name);
            const b = effects.get(entrypoints[j].name);
            if (!a || !b) { independent++; continue; }

            const always: string[] = [];
            const sameKey: string[] = [];

            const touched = new Set([
                ...a.reads.keys(), ...a.writes.keys(),
                ...b.reads.keys(), ...b.writes.keys(),
            ]);

            for (const variable of touched) {
                const aWrite = a.writes.get(variable);
                const bWrite = b.writes.get(variable);
                const aRead = a.reads.get(variable);
                const bRead = b.reads.get(variable);

                // Two readers never conflict, no matter how hot the slot is.
                if (!aWrite && !bWrite) continue;
                const opposesA = aWrite && (bWrite || bRead);
                const opposesB = bWrite && (aWrite || aRead);
                if (!opposesA && !opposesB) continue;

                const scopes = [aWrite, bWrite, aRead, bRead]
                    .filter((effect): effect is SlotEffect => Boolean(effect))
                    .map((effect) => effect.scope);
                const worst = scopes.reduce((acc, scope) => (SCOPE_RANK[scope] > SCOPE_RANK[acc] ? scope : acc), 'caller' as AccessScope);

                if (worst === 'global') always.push(variable);
                else if (worst === 'keyed') sameKey.push(variable);
                // 'caller' means both sides key by msg.sender: different senders,
                // different slots, genuinely concurrent.
            }

            if (always.length > 0) {
                blocked++;
                for (const variable of always) {
                    blockedByVariable.set(variable, (blockedByVariable.get(variable) ?? 0) + 1);
                }
                conflictPairs.push({ a: entrypoints[i].name, b: entrypoints[j].name, variables: always, certainty: 'always' });
            } else if (sameKey.length > 0) {
                conditional++;
                conflictPairs.push({ a: entrypoints[i].name, b: entrypoints[j].name, variables: sameKey, certainty: 'same-key' });
            } else {
                independent++;
            }
        }
    }

    return {
        conflictPairs,
        blockedByVariable,
        metrics: {
            pairsTotal: blocked + conditional + independent,
            pairsBlocked: blocked,
            pairsConditional: conditional,
            pairsIndependent: independent,
            globalSlots: 0,
            keyedSlots: 0,
            callerSlots: 0,
        },
    };
}

function applyContention(entrypoints: Entrypoint[], pairs: ConflictPair[]) {
    const index = new Map(entrypoints.map((entry) => [entry.name, entry]));

    for (const pair of pairs) {
        const a = index.get(pair.a);
        const b = index.get(pair.b);
        if (!a || !b) continue;

        if (pair.certainty === 'always') {
            if (!a.conflictsWith.includes(pair.b)) a.conflictsWith.push(pair.b);
            if (!b.conflictsWith.includes(pair.a)) b.conflictsWith.push(pair.a);
        } else {
            if (!a.contendsOnKeyWith.includes(pair.b)) a.contendsOnKeyWith.push(pair.b);
            if (!b.contendsOnKeyWith.includes(pair.a)) b.contendsOnKeyWith.push(pair.a);
        }
    }

    for (const entry of entrypoints) {
        const globals = entry.writes.filter((write) => write.scope === 'global');

        if (entry.conflictsWith.length > 0) {
            entry.contention = 'serial';
            entry.canParallelize = false;
            const selfOnly = entry.conflictsWith.length === 1 && entry.conflictsWith[0] === entry.name;
            entry.reason = globals.length > 0
                ? selfOnly
                    ? `Writes ${listOf(globals.map((w) => w.variable))}, one slot for the whole contract. Concurrent calls to ${entry.name} alone already serialise.`
                    : `Writes ${listOf(globals.map((w) => w.variable))}, shared with ${listOf(entry.conflictsWith.filter((n) => n !== entry.name))}.`
                : `Reads ${listOf(entry.reads.filter((r) => r.scope === 'global').map((r) => r.variable))}, which ${listOf(entry.conflictsWith.filter((n) => n !== entry.name))} overwrite.`;
        } else if (entry.contendsOnKeyWith.length > 0) {
            entry.contention = 'conditional';
            entry.canParallelize = true;
            entry.reason = `Touches ${listOf([...new Set(entry.writes.filter((w) => w.scope === 'keyed').map((w) => w.variable))])} by key. Two transactions only serialise when they hit the same key.`;
        } else {
            entry.contention = 'independent';
            entry.canParallelize = true;
            entry.reason = entry.writes.length === 0
                ? 'Writes no contract storage.'
                : 'Every slot it writes is keyed by the caller, so no two senders collide.';
        }
    }
}

function buildHotspots(
    entrypoints: Entrypoint[],
    effects: Map<string, FunctionEffects>,
    storage: Map<string, StateVariable>,
    blockedByVariable: Map<string, number>
): Hotspot[] {
    const hotspots: Hotspot[] = [];
    const variables = new Set<string>();

    for (const entry of entrypoints) {
        for (const effect of [...entry.reads, ...entry.writes]) variables.add(effect.variable);
    }

    for (const variable of variables) {
        const writers: string[] = [];
        const readers: string[] = [];
        let scope: AccessScope = 'caller';
        let accumulator = true;

        for (const entry of entrypoints) {
            const own = effects.get(entry.name);
            if (!own) continue;
            const write = own.writes.get(variable);
            const read = own.reads.get(variable);
            if (write) {
                writers.push(entry.name);
                if (SCOPE_RANK[write.scope] > SCOPE_RANK[scope]) scope = write.scope;
                accumulator &&= Boolean(write.accumulate);
            }
            if (read && !write) readers.push(entry.name);
            if (read && SCOPE_RANK[read.scope] > SCOPE_RANK[scope]) scope = read.scope;
        }

        // A slot nobody writes from an entrypoint cannot cause a re-execution.
        if (writers.length === 0) continue;

        const declared = storage.get(variable);
        const severity: Hotspot['severity'] = scope === 'global' ? 'high' : scope === 'keyed' ? 'medium' : 'low';

        hotspots.push({
            variable,
            typeText: declared?.typeText ?? 'unknown',
            scope,
            writers,
            readers,
            severity,
            blockedPairs: blockedByVariable.get(variable) ?? 0,
            accumulator,
            impact: impactOf(variable, scope, writers, readers),
            line: declared?.line ?? 0,
        });
    }

    // Measured cost first: a slot that stalls fifteen pairs matters more than
    // one that stalls two, whatever their names happen to sort as.
    const order = { high: 0, medium: 1, low: 2 };
    return hotspots.sort((a, b) =>
        order[a.severity] - order[b.severity] ||
        b.blockedPairs - a.blockedPairs ||
        (b.writers.length + b.readers.length) - (a.writers.length + a.readers.length) ||
        a.variable.localeCompare(b.variable));
}

function impactOf(variable: string, scope: AccessScope, writers: string[], readers: string[]): string {
    const touching = [...new Set([...writers, ...readers])];

    if (scope === 'global') {
        return `One slot for every caller. ${listOf(writers)} write it${readers.length > 0 ? ` and ${listOf(readers)} read it` : ''}, so ${touching.length > 1 ? 'those calls' : 'concurrent calls'} always execute one after another.`;
    }
    if (scope === 'keyed') {
        return `Addressed by a runtime key. ${listOf(writers)} only serialise against another transaction that uses the same key.`;
    }
    return `Keyed by msg.sender, so each account owns its own slot. Different senders never collide here.`;
}

function scoreFrom(metrics: ParallelMetrics): { score: number; grade: Grade } {
    if (metrics.pairsTotal === 0) return { score: 100, grade: 'A' };

    const weighted = metrics.pairsIndependent + CONDITIONAL_WEIGHT * metrics.pairsConditional;
    const score = Math.max(0, Math.min(100, Math.round((weighted / metrics.pairsTotal) * 100)));

    const grade: Grade =
        score >= 90 ? 'A' :
        score >= 75 ? 'B' :
        score >= 60 ? 'C' :
        score >= 40 ? 'D' : 'F';

    return { score, grade };
}

function headlineFor(score: number, total: number, parallel: number): string {
    if (total === 0) return 'No state-changing entrypoints to schedule.';
    return `${score}% of concurrent transaction pairs run without contention. ${parallel} of ${total} entrypoints stay parallel.`;
}

function summaryFor(score: number, entrypoints: Entrypoint[], hotspots: Hotspot[], readOnlyCount: number): string {
    if (entrypoints.length === 0) {
        return 'This contract exposes no state-changing entrypoints, so there is nothing for the scheduler to serialise.';
    }

    const serial = entrypoints.filter((entry) => entry.contention === 'serial');
    const globals = hotspots.filter((hotspot) => hotspot.scope === 'global');
    const parts: string[] = [];

    parts.push(
        score >= 75
            ? 'State is well separated. Most transactions against this contract can execute concurrently on Monad.'
            : score >= 40
                ? 'Part of this contract parallelises cleanly and part of it does not.'
                : 'Almost every transaction against this contract has to wait for the one before it.'
    );

    if (globals.length > 0) {
        parts.push(
            `${globals.length} ${globals.length === 1 ? 'slot is' : 'slots are'} shared by every caller: ${listOf(globals.slice(0, 4).map((h) => h.variable))}${globals.length > 4 ? ', and others' : ''}. Any two transactions that touch one of them serialise.`
        );
    }

    if (serial.length > 0) {
        parts.push(`${listOf(serial.map((entry) => `${entry.name}()`))} cannot run alongside each other.`);
    } else {
        parts.push('No entrypoint pair is forced to serialise.');
    }

    if (readOnlyCount > 0) {
        parts.push(`${readOnlyCount} view ${readOnlyCount === 1 ? 'function was' : 'functions were'} excluded: they send no transactions and never contend.`);
    }

    return parts.join(' ');
}

function buildNotes(hotspots: Hotspot[], entrypoints: Entrypoint[]): string[] {
    const notes: string[] = [];

    const callerScoped = hotspots.filter((hotspot) => hotspot.scope === 'caller');
    if (callerScoped.length > 0) {
        notes.push(`${listOf(callerScoped.map((h) => h.variable))} ${callerScoped.length === 1 ? 'is' : 'are'} keyed by msg.sender and already parallel by construction.`);
    }

    const independent = entrypoints.filter((entry) => entry.contention === 'independent');
    if (independent.length > 0) {
        notes.push(`${listOf(independent.map((entry) => `${entry.name}()`))} ${independent.length === 1 ? 'needs' : 'need'} no change.`);
    }

    return notes;
}

function buildSuggestions(
    hotspots: Hotspot[],
    storage: Map<string, StateVariable>,
    entrypoints: Entrypoint[]
): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    for (const hotspot of hotspots.filter((h) => h.scope === 'global' && h.blockedPairs > 0).slice(0, 5)) {
        const declared = storage.get(hotspot.variable);

        if (hotspot.accumulator && /^u?int/.test(declared?.typeText ?? '')) {
            suggestions.push({
                type: 'shard_counter',
                priority: 'high',
                title: `Shard the counter '${hotspot.variable}'`,
                description:
                    `${listOf(hotspot.writers)} all increment '${hotspot.variable}', a single slot. ` +
                    `Splitting it across N stripes lets N transactions proceed at once; the true value is the sum, ` +
                    `read only where it is actually needed.`,
                currentCode: `${declared?.typeText ?? 'uint256'} public ${hotspot.variable};\n\n${hotspot.variable} += amount;`,
                suggestedCode:
                    `uint256 private constant STRIPES = 16;\n` +
                    `mapping(uint256 => uint256) private _${hotspot.variable}Stripe;\n\n` +
                    `// Different senders land on different slots, so these do not contend.\n` +
                    `_${hotspot.variable}Stripe[uint256(uint160(msg.sender)) % STRIPES] += amount;\n\n` +
                    `function ${hotspot.variable}() public view returns (uint256 total) {\n` +
                    `    for (uint256 i = 0; i < STRIPES; i++) total += _${hotspot.variable}Stripe[i];\n` +
                    `}`,
                impact: `Up to ${hotspot.blockedPairs} fewer blocked pairs`,
            });
        } else {
            suggestions.push({
                type: 'state_separation',
                priority: hotspot.blockedPairs > 2 ? 'high' : 'medium',
                title: `Give '${hotspot.variable}' a key`,
                description:
                    `'${hotspot.variable}' is one slot written by ${listOf(hotspot.writers)}, and it blocks ` +
                    `${hotspot.blockedPairs} entrypoint ${hotspot.blockedPairs === 1 ? 'pair' : 'pairs'}. ` +
                    `If its value is really per account, per market or per position, storing it under that key ` +
                    `removes the contention rather than reducing it. If it is a genuine contract-wide invariant ` +
                    `such as an AMM reserve or a reentrancy flag, it cannot be split and should stay as it is.`,
                currentCode: `${declared?.typeText ?? 'uint256'} public ${hotspot.variable};\n\n${hotspot.variable} = newValue;`,
                suggestedCode:
                    `mapping(address => ${declared?.typeText ?? 'uint256'}) public ${hotspot.variable};\n\n` +
                    `${hotspot.variable}[msg.sender] = newValue;`,
                impact: `Up to ${hotspot.blockedPairs} fewer blocked pairs`,
            });
        }
    }

    const packable = [...storage.values()].filter((variable) =>
        variable.mutability === 'mutable' &&
        /^(bool|uint(8|16|32|64|96|128)|int(8|16|32|64|96|128)|address|bytes([1-9]|1[0-6]))$/.test(variable.typeText.trim())
    );
    if (packable.length >= 2) {
        suggestions.push({
            type: 'storage_packing',
            priority: 'medium',
            title: 'Pack the small state variables together',
            description:
                `${listOf(packable.slice(0, 5).map((v) => v.name))} are each narrower than a word. Declared next to ` +
                `each other they share one slot, which is both cheaper to write and one conflict point instead of several.`,
            currentCode: packable.slice(0, 3).map((v) => `${v.typeText} public ${v.name};`).join('\n'),
            suggestedCode:
                '// Adjacent declarations that fit in 32 bytes share a slot\n' +
                packable.slice(0, 3).map((v) => `${v.typeText} public ${v.name};`).join('\n'),
            impact: 'Fewer slots written, ~2,100 gas saved per slot removed',
        });
    }

    if (suggestions.length === 0) {
        suggestions.push({
            type: 'already_optimal',
            priority: 'low',
            title: 'No forced serialisation found',
            description:
                entrypoints.length === 0
                    ? 'This contract has no state-changing entrypoints.'
                    : 'Every slot these entrypoints write is addressed by a key, so transactions only serialise when they genuinely touch the same data.',
            impact: 'Already suited to Monad',
        });
    }

    return suggestions;
}

function listOf(names: string[]): string {
    const unique = [...new Set(names)];
    if (unique.length === 0) return 'nothing';
    if (unique.length === 1) return unique[0];
    if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
    return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}

/**
 * A contract was found, but it declares no state-changing entrypoints of its own.
 * Usually that means every entrypoint lives in an imported base, which this
 * analysis cannot see. Reported as unscored rather than as perfect.
 */
function unscorableResult(
    contract: string,
    options: ContractOption[],
    unresolvedBases: string[],
    readOnlyFunctions: ReadOnlyFunction[],
): ParallelAnalysisResult {
    const message = unresolvedBases.length > 0
        ? `${contract} declares no state-changing entrypoints of its own. Everything it exposes comes from ` +
          `${unresolvedBases.join(', ')}, which ${unresolvedBases.length === 1 ? 'is' : 'are'} imported and not ` +
          `part of this file, so there is nothing here to schedule or to score.`
        : `${contract} has no state-changing entrypoints, so there is nothing to schedule. ` +
          `Read-only functions never contend.`;

    return {
        contract,
        availableContracts: options,
        score: 0,
        grade: 'F',
        headline: 'Not scored: no entrypoints visible in this file.',
        summary: message,
        totalFunctions: 0,
        parallelizableFunctions: 0,
        entrypoints: [],
        readOnlyFunctions,
        hotspots: [],
        conflictPairs: [],
        suggestions: [],
        metrics: {
            pairsTotal: 0, pairsBlocked: 0, pairsConditional: 0, pairsIndependent: 0,
            globalSlots: 0, keyedSlots: 0, callerSlots: 0,
        },
        notes: unresolvedBases.length > 0
            ? [`Flatten the contract, or paste the base contracts alongside it, to include them.`]
            : [],
    };
}

function emptyResult(options: ContractOption[], requested?: string): ParallelAnalysisResult {
    const message = requested
        ? `No contract named ${requested} in this file.`
        : 'No deployable contract found. Interfaces, libraries and abstract contracts have no storage to schedule.';

    return {
        contract: requested ?? '',
        availableContracts: options,
        score: 0,
        grade: 'F',
        headline: message,
        summary: message,
        totalFunctions: 0,
        parallelizableFunctions: 0,
        entrypoints: [],
        readOnlyFunctions: [],
        hotspots: [],
        conflictPairs: [],
        suggestions: [],
        metrics: {
            pairsTotal: 0, pairsBlocked: 0, pairsConditional: 0, pairsIndependent: 0,
            globalSlots: 0, keyedSlots: 0, callerSlots: 0,
        },
        notes: [],
    };
}

/** Compact result for inline feedback while the user is still typing. */
export function quickAnalysis(sourceCode: string): { score: number; grade: Grade; blockedPairs: number } {
    const result = analyzeParallelPotential(sourceCode);
    return { score: result.score, grade: result.grade, blockedPairs: result.metrics.pairsBlocked };
}
