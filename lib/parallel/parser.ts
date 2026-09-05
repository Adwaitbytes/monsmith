/**
 * A structural Solidity reader, scoped to what conflict analysis needs.
 *
 * This is deliberately not a full parser. It answers four questions the
 * previous line-by-line regex pass got wrong on every real contract: which
 * declaration unit does a piece of code belong to, which identifiers are
 * genuinely storage, which are function-local, and which functions are
 * reachable from outside. Getting those wrong is what made a flattened
 * Uniswap file report 35 "functions" of one contract and flag the local
 * `amount0In` as a contended storage slot.
 */

import { lastIdentifier, lineCounter, matchDelimiter, splitTopLevel, stripNonCode } from './source';

export type UnitKind = 'contract' | 'library' | 'interface';
export type Mutability = 'mutable' | 'constant' | 'immutable';
export type StateMutability = 'pure' | 'view' | 'payable' | 'nonpayable';
export type Visibility = 'public' | 'external' | 'internal' | 'private';
export type VarShape = 'value' | 'mapping' | 'array';

export interface StateVariable {
    name: string;
    typeText: string;
    shape: VarShape;
    mutability: Mutability;
    visibility: Visibility;
    /** Declaring unit, which differs from the analysed contract under inheritance. */
    declaredIn: string;
    line: number;
}

export type FunctionKind = 'function' | 'constructor' | 'modifier' | 'receive' | 'fallback';

export interface FunctionDef {
    name: string;
    kind: FunctionKind;
    visibility: Visibility;
    stateMutability: StateMutability;
    /** Parameter and named-return identifiers. Both shadow storage of the same name. */
    params: string[];
    returns: string[];
    /** Modifier names applied to this function; their bodies count as its effects. */
    appliedModifiers: string[];
    signature: string;
    body: string;
    declaredIn: string;
    line: number;
}

export interface EventDef {
    name: string;
    /** Normalised parameter types, which is what the topic hash is built from. */
    paramTypes: string[];
}

export interface UnitDef {
    name: string;
    kind: UnitKind;
    abstract: boolean;
    bases: string[];
    stateVariables: StateVariable[];
    functions: FunctionDef[];
    events: EventDef[];
    line: number;
}

const ELEMENTARY = /^(u?int\d*|address|bool|string|bytes\d*|byte|fixed\d*x?\d*|ufixed\d*x?\d*)$/;

const DECLARATION_KEYWORDS = new Set([
    'function', 'constructor', 'modifier', 'receive', 'fallback',
    'struct', 'enum', 'event', 'error', 'using', 'import', 'pragma', 'type',
]);

const UNIT_HEADER = /\b(abstract\s+)?(contract|library|interface)\s+([A-Za-z_$][\w$]*)\s*(is\s+[^{]+)?\{/g;

/** Parses every contract, library and interface declared in one source file. */
export function parseSolidity(rawSource: string): UnitDef[] {
    const source = stripNonCode(rawSource);
    const lineOf = lineCounter(source);
    const units: UnitDef[] = [];

    UNIT_HEADER.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = UNIT_HEADER.exec(source)) !== null) {
        const open = source.indexOf('{', match.index);
        if (open === -1) break;
        const end = matchDelimiter(source, open);
        const body = source.slice(open + 1, Math.max(open + 1, end - 1));

        const bases = (match[4] || '')
            .replace(/^is\s+/, '')
            .split(',')
            .map((base) => (base.match(/[A-Za-z_$][\w$]*/) || [''])[0])
            .filter(Boolean);

        const name = match[3];
        const unit: UnitDef = {
            name,
            kind: match[2] as UnitKind,
            abstract: Boolean(match[1]),
            bases,
            stateVariables: [],
            functions: [],
            events: [],
            line: lineOf(match.index),
        };

        const bodyOffset = open + 1;
        unit.functions = parseFunctions(source, bodyOffset, body, name, lineOf);
        unit.stateVariables = parseStateVariables(body, bodyOffset, name, lineOf);
        unit.events = parseEvents(body);

        units.push(unit);

        // Nested declarations are not legal, so resume the scan past this unit.
        UNIT_HEADER.lastIndex = end;
    }

    return units;
}

/**
 * Reads the declarations that sit directly in a unit body.
 *
 * Everything inside a nested block is skipped wholesale, which is the point:
 * `uint amount0In = ...` inside `swap` is a stack variable and must never be
 * mistaken for a storage slot.
 */
function parseStateVariables(
    body: string,
    bodyOffset: number,
    unitName: string,
    lineOf: (index: number) => number
): StateVariable[] {
    const variables: StateVariable[] = [];

    let i = 0;
    let statementStart = 0;

    const takeStatement = (end: number) => {
        const text = body.slice(statementStart, end);
        const variable = parseVariableDeclaration(text, unitName, lineOf(bodyOffset + statementStart));
        if (variable) variables.push(variable);
    };

    while (i < body.length) {
        const c = body[i];

        if (c === '{') {
            // A block ends the current statement: it is a function, struct or enum body.
            i = matchDelimiter(body, i);
            statementStart = i;
            continue;
        }

        if (c === '(') {
            i = matchDelimiter(body, i, '(', ')');
            continue;
        }

        if (c === ';') {
            takeStatement(i);
            i++;
            statementStart = i;
            continue;
        }

        i++;
    }

    return variables;
}

/** Turns one top-level statement into a state variable, or null if it is not one. */
function parseVariableDeclaration(statement: string, unitName: string, line: number): StateVariable | null {
    const text = statement.trim();
    if (!text) return null;

    const firstWord = (text.match(/^[A-Za-z_$][\w$]*/) || [''])[0];
    if (DECLARATION_KEYWORDS.has(firstWord)) return null;

    // The initialiser is dropped before naming: `=>` only ever appears inside a
    // mapping's parentheses, so a depth-zero `=` is always the assignment.
    const head = splitTopLevel(text, '=')[0].trim();
    if (!head) return null;

    const name = lastIdentifier(head);
    if (!name) return null;

    const keywords = new Set(['public', 'private', 'internal', 'external', 'constant', 'immutable', 'override', 'transient']);
    if (keywords.has(name)) return null;

    const declaration = head.slice(0, head.lastIndexOf(name));
    const words = declaration.match(/[A-Za-z_$][\w$]*/g) || [];

    const mutability: Mutability = /\bconstant\b/.test(declaration)
        ? 'constant'
        : /\bimmutable\b/.test(declaration)
            ? 'immutable'
            : 'mutable';

    const visibility: Visibility = /\bpublic\b/.test(declaration)
        ? 'public'
        : /\bexternal\b/.test(declaration)
            ? 'external'
            : /\bprivate\b/.test(declaration)
                ? 'private'
                : 'internal';

    const typeText = declaration
        .replace(/\b(public|private|internal|external|constant|immutable|override|transient)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!typeText) return null;

    const shape: VarShape = /^mapping\s*\(/.test(typeText)
        ? 'mapping'
        : /\]\s*$/.test(typeText)
            ? 'array'
            : 'value';

    // A bare type word that is neither elementary nor a plausible user type means
    // this statement was something else entirely.
    const head0 = words[0] || '';
    if (shape === 'value' && !ELEMENTARY.test(head0) && !/^[A-Z]/.test(head0) && head0 !== 'mapping') {
        return null;
    }

    return { name, typeText, shape, mutability, visibility, declaredIn: unitName, line };
}

/** Events declared directly in a unit body. Nested blocks cannot contain them. */
function parseEvents(body: string): EventDef[] {
    const events: EventDef[] = [];
    const surface = blankNestedBlocks(body);
    const pattern = /\bevent\s+([A-Za-z_$][\w$]*)\s*\(/g;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(surface)) !== null) {
        const open = surface.indexOf('(', match.index);
        const close = matchDelimiter(body, open, '(', ')');
        events.push({
            name: match[1],
            paramTypes: parameterTypes(body.slice(open + 1, Math.max(open + 1, close - 1))),
        });
        pattern.lastIndex = close;
    }

    return events;
}

/**
 * Canonical parameter types for one parameter list.
 *
 * Names, data locations and `indexed` do not affect a selector or a topic hash,
 * and `uint` is a synonym for `uint256`, so all of that is normalised away
 * before two signatures are compared.
 */
export function parameterTypes(list: string): string[] {
    return splitTopLevel(list, ',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
            const words = entry
                .replace(/\b(indexed|memory|calldata|storage)\b/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            // `address payable to` keeps `address`; a trailing name is dropped
            // only when the declaration has more than one word left.
            const parts = words.split(' ');
            const type = parts.length > 1 && /^[A-Za-z_$][\w$]*$/.test(parts[parts.length - 1])
                ? parts.slice(0, -1).join(' ')
                : words;

            return type
                .replace(/\bpayable\b/g, '')
                .replace(/\buint\b(?!\d)/g, 'uint256')
                .replace(/\bint\b(?!\d)/g, 'int256')
                .replace(/\bbyte\b/g, 'bytes1')
                .replace(/\s+/g, '')
                .trim();
        })
        .filter(Boolean);
}

const CALLABLE_HEADER = /\b(function\s+([A-Za-z_$][\w$]*)|constructor|modifier\s+([A-Za-z_$][\w$]*)|receive|fallback)\s*\(/g;

/** Reads every callable declared directly in a unit body. */
function parseFunctions(
    source: string,
    bodyOffset: number,
    body: string,
    unitName: string,
    lineOf: (index: number) => number
): FunctionDef[] {
    const functions: FunctionDef[] = [];

    // Nested block contents are blanked so a callable is only found at unit level.
    const surface = blankNestedBlocks(body);

    CALLABLE_HEADER.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = CALLABLE_HEADER.exec(surface)) !== null) {
        const parenOpen = surface.indexOf('(', match.index);
        if (parenOpen === -1) break;

        const parenEnd = matchDelimiter(body, parenOpen, '(', ')');
        const paramText = body.slice(parenOpen + 1, Math.max(parenOpen + 1, parenEnd - 1));

        // The header runs to the body brace, or to `;` for an unimplemented member.
        let cursor = parenEnd;
        while (cursor < body.length && body[cursor] !== '{' && body[cursor] !== ';') cursor++;

        const header = body.slice(parenEnd, cursor);
        const hasBody = body[cursor] === '{';
        const bodyEnd = hasBody ? matchDelimiter(body, cursor) : cursor;
        const functionBody = hasBody ? body.slice(cursor + 1, Math.max(cursor + 1, bodyEnd - 1)) : '';

        const kind: FunctionKind = match[2]
            ? 'function'
            : match[3]
                ? 'modifier'
                : (match[1].startsWith('constructor') ? 'constructor'
                    : match[1].startsWith('receive') ? 'receive' : 'fallback');

        const name = match[2] || match[3] || kind;

        const returnsMatch = header.match(/\breturns\s*\(/);
        const returnsText = returnsMatch
            ? header.slice(
                returnsMatch.index! + returnsMatch[0].length - 1,
                matchDelimiter(header, returnsMatch.index! + returnsMatch[0].length - 1, '(', ')')
            )
            : '';

        functions.push({
            name,
            kind,
            visibility: readVisibility(header, kind),
            stateMutability: readStateMutability(header, kind),
            params: declaredNames(paramText),
            returns: declaredNames(returnsText),
            appliedModifiers: readAppliedModifiers(header),
            signature: `${name}(${paramText.replace(/\s+/g, ' ').trim()})`,
            body: functionBody,
            declaredIn: unitName,
            line: lineOf(bodyOffset + match.index),
        });

        CALLABLE_HEADER.lastIndex = Math.max(bodyEnd, match.index + 1);
    }

    return functions;
}

/** Replaces the contents of every nested `{ }` block with spaces of equal length. */
function blankNestedBlocks(body: string): string {
    const out = body.split('');
    let i = 0;

    while (i < body.length) {
        if (body[i] === '{') {
            const end = matchDelimiter(body, i);
            for (let k = i; k < end; k++) {
                if (out[k] !== '\n') out[k] = ' ';
            }
            i = end;
            continue;
        }
        i++;
    }

    return out.join('');
}

function readVisibility(header: string, kind: FunctionKind): Visibility {
    if (kind === 'constructor') return 'public';
    if (kind === 'receive' || kind === 'fallback') return 'external';
    if (kind === 'modifier') return 'internal';
    if (/\bexternal\b/.test(header)) return 'external';
    if (/\bprivate\b/.test(header)) return 'private';
    if (/\binternal\b/.test(header)) return 'internal';
    return 'public';
}

function readStateMutability(header: string, kind: FunctionKind): StateMutability {
    if (kind === 'constructor') return 'nonpayable';
    if (/\bpure\b/.test(header)) return 'pure';
    if (/\bview\b/.test(header)) return 'view';
    if (/\bpayable\b/.test(header)) return 'payable';
    return 'nonpayable';
}

const NOT_A_MODIFIER = new Set([
    'public', 'private', 'internal', 'external', 'pure', 'view', 'payable',
    'returns', 'virtual', 'override', 'memory', 'storage', 'calldata',
]);

function readAppliedModifiers(header: string): string[] {
    // Everything before `returns` is the modifier list; a name there that is not
    // a language keyword is a modifier invocation.
    const beforeReturns = header.split(/\breturns\b/)[0];
    const names = beforeReturns.match(/[A-Za-z_$][\w$]*/g) || [];
    return names.filter((word) => !NOT_A_MODIFIER.has(word));
}

/** Identifier names declared in a parameter or named-return list. */
function declaredNames(list: string): string[] {
    return splitTopLevel(list, ',')
        .map((entry) => lastIdentifier(entry.trim()))
        .filter((name) => Boolean(name) && !/^(memory|storage|calldata|payable)$/.test(name));
}

/**
 * Flattens a contract with its bases, most-derived last.
 *
 * Inheritance is why the old pass could not tell that `transfer` on a pair
 * contract writes `balanceOf`: the mapping is declared in the ERC20 base, in a
 * different unit of the same file.
 */
export function linearize(unit: UnitDef, byName: Map<string, UnitDef>): UnitDef[] {
    const chain: UnitDef[] = [];
    const seen = new Set<string>();

    const visit = (current: UnitDef) => {
        if (seen.has(current.name)) return;
        seen.add(current.name);
        for (const base of current.bases) {
            const resolved = byName.get(base);
            if (resolved) visit(resolved);
        }
        chain.push(current);
    };

    visit(unit);
    return chain;
}
