/**
 * Storage effect extraction: which slots a function actually reads and writes.
 *
 * Two things make this different from grepping a body for variable names.
 * First, locals shadow storage, and a token contract's hottest identifiers
 * (`amount`, `balance`, `digest`) are almost always stack variables. Second,
 * effects propagate through internal calls and modifiers: `swap` never names
 * `reserve0`, it calls `_update`, and a reader who is not told that learns
 * nothing about why their swaps serialise.
 */

import { matchDelimiter, splitTopLevel } from './source';
import type { FunctionDef, StateVariable, UnitDef } from './parser';

/**
 * How a slot is addressed, which is exactly what decides whether two
 * transactions collide on Monad's optimistic scheduler.
 */
export type AccessScope =
    /** One slot for the whole contract. Every caller lands on it. */
    | 'global'
    /** Keyed by `msg.sender`, so distinct senders never touch the same slot. */
    | 'caller'
    /** Keyed by a runtime value, so collisions happen only on equal keys. */
    | 'keyed';

export interface SlotEffect {
    variable: string;
    scope: AccessScope;
    read: boolean;
    write: boolean;
    /**
     * True when the new value is derived from the old one (`+=`, `++`, or
     * `x = x.add(n)`). Only an accumulator can be split into stripes and summed
     * back; advising the same for a reserve or a reentrancy flag would break the
     * invariant the slot exists to hold.
     */
    accumulate?: boolean;
    /** Source lines where the access occurs, for the inspector. */
    lines: number[];
    /** Set when the effect was inherited from a callee rather than written inline. */
    via?: string;
}

export interface FunctionEffects {
    reads: Map<string, SlotEffect>;
    writes: Map<string, SlotEffect>;
    /** Internal callees folded into this function's effects, for explanation. */
    through: string[];
}

const RESERVED = new Set([
    'if', 'else', 'for', 'while', 'do', 'return', 'returns', 'require', 'assert', 'revert',
    'emit', 'new', 'delete', 'memory', 'storage', 'calldata', 'public', 'private', 'internal',
    'external', 'view', 'pure', 'payable', 'true', 'false', 'this', 'super', 'msg', 'block',
    'tx', 'abi', 'type', 'unchecked', 'try', 'catch', 'function', 'mapping', 'struct', 'enum',
]);

const ELEMENTARY_TYPE = /^(u?int\d*|address|bool|string|bytes\d*|byte)$/;

/**
 * Names bound on the stack inside a body: parameters, named returns and locals.
 * Anything here outranks a storage variable of the same name.
 */
export function localBindings(func: FunctionDef): Set<string> {
    const bound = new Set<string>([...func.params, ...func.returns]);
    const body = func.body;

    // `uint256 x`, `address payable y`, `bytes32 digest`
    const elementary = /\b(u?int\d*|address|bool|string|bytes\d*|byte)\s+(?:payable\s+)?(?:memory\s+|storage\s+|calldata\s+)?([A-Za-z_$][\w$]*)/g;
    // `MyStruct memory s`, `uint[] memory amounts`, `IERC20 token`
    const located = /\b([A-Za-z_$][\w$]*)(?:\s*\[\s*\])?\s+(?:memory|storage|calldata)\s+([A-Za-z_$][\w$]*)/g;
    // `for (uint i = 0; ...)`
    const loop = /\bfor\s*\(\s*(u?int\d*)\s+([A-Za-z_$][\w$]*)/g;

    for (const pattern of [elementary, located, loop]) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(body)) !== null) {
            if (match[2]) bound.add(match[2]);
        }
    }

    // Tuple destructuring: `(uint112 _r0, uint112 _r1,) = getReserves();`
    const tuple = /\(([^()]*)\)\s*=[^=]/g;
    tuple.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = tuple.exec(body)) !== null) {
        for (const entry of splitTopLevel(match[1], ',')) {
            const words = entry.trim().match(/[A-Za-z_$][\w$]*/g);
            if (words && words.length >= 2 && (ELEMENTARY_TYPE.test(words[0]) || /^[A-Z]/.test(words[0]))) {
                bound.add(words[words.length - 1]);
            }
        }
    }

    return bound;
}

/**
 * Direct storage accesses in one body, ignoring anything shadowed by a local.
 */
export function directEffects(
    func: FunctionDef,
    storage: Map<string, StateVariable>,
    lineOf: (offsetInBody: number) => number
): FunctionEffects {
    const shadowed = localBindings(func);
    const reads = new Map<string, SlotEffect>();
    const writes = new Map<string, SlotEffect>();
    const body = func.body;

    const identifier = /[A-Za-z_$][\w$]*/g;
    let match: RegExpExecArray | null;

    while ((match = identifier.exec(body)) !== null) {
        const name = match[0];
        if (RESERVED.has(name) || shadowed.has(name)) continue;

        const variable = storage.get(name);
        // Constants and immutables live in code, not storage: they can never contend.
        if (!variable || variable.mutability !== 'mutable') continue;

        // A member of something else (`pair.token0`) is not this contract's slot.
        const before = body.slice(Math.max(0, match.index - 24), match.index);
        if (/\.\s*$/.test(before)) continue;

        const path = readAccessPath(body, match.index + name.length, name);
        const scope = classifyScope(variable, path.keys);
        const line = lineOf(match.index);

        const isWrite = path.isWrite || /\bdelete\s*$/.test(before);
        // A compound assignment and an increment both read the old value first.
        const isRead = !isWrite || path.readsBeforeWrite;

        if (isWrite) record(writes, name, scope, false, true, line, undefined, path.accumulate);
        if (isRead) record(reads, name, scope, true, false, line);

        identifier.lastIndex = Math.max(identifier.lastIndex, match.index + name.length);
    }

    return { reads, writes, through: [] };
}

interface AccessPath {
    keys: string[];
    isWrite: boolean;
    /** True for `+=`, `++` and friends, which consume the current value. */
    readsBeforeWrite: boolean;
    accumulate: boolean;
}

/** Walks `name[...][...].field` forward and decides whether it is being written. */
function readAccessPath(body: string, start: number, name: string): AccessPath {
    const keys: string[] = [];
    let i = start;

    const skipSpace = () => { while (i < body.length && /\s/.test(body[i])) i++; };

    for (;;) {
        skipSpace();
        if (body[i] === '[') {
            const end = matchDelimiter(body, i, '[', ']');
            keys.push(body.slice(i + 1, Math.max(i + 1, end - 1)).trim());
            i = end;
            continue;
        }
        if (body[i] === '.') {
            const member = body.slice(i + 1).match(/^\s*([A-Za-z_$][\w$]*)/);
            if (!member) break;
            // `.push(` and `.pop(` mutate the array, including its length slot.
            if (member[1] === 'push' || member[1] === 'pop') {
                return { keys, isWrite: true, readsBeforeWrite: false, accumulate: true };
            }
            i += 1 + member[0].length;
            continue;
        }
        break;
    }

    skipSpace();
    const tail = body.slice(i, i + 3);

    if (/^(\+\+|--)/.test(tail)) return { keys, isWrite: true, readsBeforeWrite: true, accumulate: true };
    if (/^(\+=|-=|\*=|\/=|%=|\|=|&=|\^=)/.test(tail)) return { keys, isWrite: true, readsBeforeWrite: true, accumulate: true };
    if (/^(<<=|>>=)/.test(tail)) return { keys, isWrite: true, readsBeforeWrite: true, accumulate: true };

    if (/^=[^=]/.test(tail) || tail === '=') {
        // `x = x.add(n)` accumulates just as `x += n` does, and SafeMath-era
        // contracts are written entirely in the first form.
        const statementEnd = body.indexOf(';', i);
        const rhs = body.slice(i + 1, statementEnd === -1 ? body.length : statementEnd);
        const selfReferential = new RegExp(`\\b${name}\\b`).test(rhs);
        return { keys, isWrite: true, readsBeforeWrite: selfReferential, accumulate: selfReferential };
    }

    return { keys, isWrite: false, readsBeforeWrite: false, accumulate: false };
}

/** A mapping keyed only by `msg.sender` is parallel by construction on Monad. */
function classifyScope(variable: StateVariable, keys: string[]): AccessScope {
    if (variable.shape === 'value' || keys.length === 0) return 'global';
    const first = keys[0].replace(/\s+/g, '');
    if (first === 'msg.sender' || first === '_msgSender()') return 'caller';
    return 'keyed';
}

function record(
    into: Map<string, SlotEffect>,
    variable: string,
    scope: AccessScope,
    read: boolean,
    write: boolean,
    line: number,
    via?: string,
    accumulate?: boolean
) {
    const existing = into.get(variable);
    if (!existing) {
        into.set(variable, { variable, scope, read, write, lines: [line], via, accumulate });
        return;
    }
    existing.read ||= read;
    existing.write ||= write;
    // One assignment that does not build on the old value means the slot is not
    // a pure accumulator, and striping it would lose whatever that write set.
    if (write) existing.accumulate = (existing.accumulate ?? true) && Boolean(accumulate);
    // The widest addressing wins: one unkeyed access makes the slot global.
    if (scope === 'global' || (scope === 'keyed' && existing.scope === 'caller')) {
        existing.scope = scope;
    }
    if (!existing.lines.includes(line)) existing.lines.push(line);
    if (via && !existing.via) existing.via = via;
}

/**
 * Folds callee and modifier effects into each function until nothing changes.
 *
 * Without this, every entrypoint of a real contract looks clean and every
 * conflict appears to live in a private helper nobody can call.
 */
export function resolveTransitiveEffects(
    chain: UnitDef[],
    storage: Map<string, StateVariable>,
    lineOfFor: (func: FunctionDef) => (offsetInBody: number) => number
): Map<string, FunctionEffects> {
    const callables = new Map<string, FunctionDef>();
    for (const unit of chain) {
        for (const func of unit.functions) {
            // A derived override replaces the base definition, matching dispatch.
            callables.set(func.name, func);
        }
    }

    const direct = new Map<string, FunctionEffects>();
    for (const [name, func] of callables) {
        direct.set(name, directEffects(func, storage, lineOfFor(func)));
    }

    const calleesOf = new Map<string, string[]>();
    for (const [name, func] of callables) {
        const called = new Set<string>();

        const call = /([A-Za-z_$][\w$]*)\s*\(/g;
        let match: RegExpExecArray | null;
        while ((match = call.exec(func.body)) !== null) {
            const target = match[1];
            if (target !== name && callables.has(target) && !RESERVED.has(target)) called.add(target);
        }
        for (const modifier of func.appliedModifiers) {
            if (callables.has(modifier)) called.add(modifier);
        }

        calleesOf.set(name, [...called]);
    }

    const resolved = new Map<string, FunctionEffects>();

    for (const name of callables.keys()) {
        const reads = new Map<string, SlotEffect>();
        const writes = new Map<string, SlotEffect>();
        const through: string[] = [];

        const visited = new Set<string>();
        const stack = [name];

        while (stack.length > 0) {
            const current = stack.pop()!;
            if (visited.has(current)) continue;
            visited.add(current);

            const own = direct.get(current);
            if (!own) continue;

            const via = current === name ? undefined : current;
            if (via) through.push(via);

            for (const effect of own.reads.values()) {
                record(reads, effect.variable, effect.scope, true, false, effect.lines[0], via);
            }
            for (const effect of own.writes.values()) {
                record(writes, effect.variable, effect.scope, false, true, effect.lines[0], via, effect.accumulate);
            }

            stack.push(...(calleesOf.get(current) || []));
        }

        resolved.set(name, { reads, writes, through });
    }

    return resolved;
}
