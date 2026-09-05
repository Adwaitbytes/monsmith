/**
 * Interface preservation check for AI-rewritten contracts.
 *
 * An optimisation that quietly drops a function, changes a signature or removes
 * an event is not an optimisation, it is a different contract: every caller,
 * indexer and front end built against the original breaks. So a rewrite is only
 * offered to the user once it has been proven to keep the whole externally
 * visible surface, and the proof is mechanical rather than a promise from the
 * model that produced it.
 *
 * The comparison works on parsed source rather than on compiler output so it
 * still applies to contracts pinned to a compiler this app does not bundle.
 */

import { linearize, parameterTypes, parseSolidity } from './parser';
import type { FunctionDef, UnitDef } from './parser';

export interface InterfaceMember {
    /** Canonical form, e.g. `transfer(address,uint256)`. */
    signature: string;
    kind: 'function' | 'event' | 'getter';
    stateMutability?: string;
}

export interface CompatibilityReport {
    compatible: boolean;
    /** Members present in the original and absent from the rewrite. */
    missing: InterfaceMember[];
    /** Members whose payability or read-only guarantee changed. */
    weakened: string[];
    /** Members the rewrite adds, which is allowed and worth showing. */
    added: InterfaceMember[];
    preservedCount: number;
}

/**
 * The externally visible surface of one contract, including everything it
 * inherits. Public state variables count: the compiler gives each one a getter
 * that callers depend on exactly as much as a hand-written function.
 */
export function publicInterface(source: string, contractName?: string): InterfaceMember[] {
    const units = parseSolidity(source);
    const byName = new Map(units.map((unit) => [unit.name, unit]));

    const target = contractName
        ? byName.get(contractName)
        : units.filter((unit) => unit.kind === 'contract' && !unit.abstract).pop();

    if (!target) return [];

    const chain = linearize(target, byName);
    const members = new Map<string, InterfaceMember>();

    const functions = new Map<string, FunctionDef>();
    for (const unit of chain) {
        for (const func of unit.functions) functions.set(func.name, func);
    }

    for (const func of functions.values()) {
        if (func.kind !== 'function') continue;
        if (func.visibility !== 'public' && func.visibility !== 'external') continue;

        const signature = canonicalSignature(func);
        members.set(`fn:${signature}`, {
            signature,
            kind: 'function',
            stateMutability: func.stateMutability,
        });
    }

    for (const unit of chain) {
        for (const variable of unit.stateVariables) {
            if (variable.visibility !== 'public') continue;
            const signature = `${variable.name}(${getterArguments(variable.typeText).join(',')})`;
            if (members.has(`fn:${signature}`)) continue;
            members.set(`fn:${signature}`, { signature, kind: 'getter', stateMutability: 'view' });
        }

        for (const event of unit.events) {
            const signature = `${event.name}(${event.paramTypes.join(',')})`;
            members.set(`ev:${signature}`, { signature, kind: 'event' });
        }
    }

    return [...members.values()];
}

/**
 * Compares a rewrite against the original.
 *
 * A getter may legitimately become a hand-written function of the same
 * signature, and vice versa, so those two kinds are treated as one.
 */
export function checkCompatibility(
    originalSource: string,
    rewrittenSource: string,
    contractName?: string
): CompatibilityReport {
    const before = publicInterface(originalSource, contractName);
    const after = publicInterface(rewrittenSource, contractName);

    const key = (member: InterfaceMember) =>
        `${member.kind === 'event' ? 'ev' : 'fn'}:${member.signature}`;

    const afterByKey = new Map(after.map((member) => [key(member), member]));
    const beforeKeys = new Set(before.map(key));

    const missing: InterfaceMember[] = [];
    const weakened: string[] = [];

    for (const member of before) {
        const match = afterByKey.get(key(member));
        if (!match) {
            missing.push(member);
            continue;
        }

        // A function that was callable with value must stay callable with value,
        // and a read-only guarantee must not silently disappear.
        if (member.stateMutability === 'payable' && match.stateMutability !== 'payable') {
            weakened.push(`${member.signature} is no longer payable`);
        }
        const readOnly = (value?: string) => value === 'view' || value === 'pure';
        if (readOnly(member.stateMutability) && !readOnly(match.stateMutability)) {
            weakened.push(`${member.signature} is no longer ${member.stateMutability}`);
        }
    }

    const added = after.filter((member) => !beforeKeys.has(key(member)));

    return {
        compatible: missing.length === 0 && weakened.length === 0,
        missing,
        weakened,
        added,
        preservedCount: before.length - missing.length,
    };
}

/** Renders the difference as the instruction to hand back to the model. */
export function describeIncompatibility(report: CompatibilityReport): string {
    const lines: string[] = [];

    if (report.missing.length > 0) {
        lines.push(
            `These members of the original contract are missing from your rewrite and must be restored exactly:\n` +
            report.missing.map((member) => `  - ${member.kind} ${member.signature}`).join('\n')
        );
    }
    if (report.weakened.length > 0) {
        lines.push(`These members changed in a way callers would notice:\n${report.weakened.map((line) => `  - ${line}`).join('\n')}`);
    }

    return lines.join('\n\n');
}

function canonicalSignature(func: FunctionDef): string {
    const open = func.signature.indexOf('(');
    const params = func.signature.slice(open + 1, func.signature.lastIndexOf(')'));
    return `${func.name}(${parameterTypes(params).join(',')})`;
}

/**
 * Argument types of the getter the compiler generates for a public variable.
 * A `mapping(address => mapping(address => uint))` getter takes both keys.
 */
function getterArguments(typeText: string): string[] {
    const args: string[] = [];
    let rest = typeText.trim();

    while (rest.startsWith('mapping')) {
        const open = rest.indexOf('(');
        const arrow = rest.indexOf('=>', open);
        if (open === -1 || arrow === -1) break;
        args.push(...parameterTypes(rest.slice(open + 1, arrow)));
        rest = rest.slice(arrow + 2, rest.lastIndexOf(')')).trim();
    }

    // An array getter takes the index.
    while (/\[\s*\]\s*$/.test(rest)) {
        args.push('uint256');
        rest = rest.replace(/\[\s*\]\s*$/, '').trim();
    }

    return args;
}

/** Names of every deployable contract in a source file, most likely target last. */
export function deployableContracts(source: string): string[] {
    return parseSolidity(source)
        .filter((unit: UnitDef) => unit.kind === 'contract' && !unit.abstract)
        .map((unit) => unit.name);
}
