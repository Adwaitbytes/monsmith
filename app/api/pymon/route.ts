// app/api/pymon/route.ts
// PyMon API Route - Python to EVM Transpiler Integration for Monsmith

import { NextResponse } from "next/server";
import { keccak256, toHex } from "viem";

/*
  The templates and the network config that used to sit here are gone.

  Both were second copies. The four Python contracts were already in
  app/studio/templates.ts, which is the one the studio actually loads, and the
  chain table said mainnet was 10143 -- the testnet id -- behind a note about
  updating it when mainnet launched. Nothing called either: the studio sends
  this route "compile" and "audit" and nothing else. A duplicate nobody reads
  is a duplicate that drifts, and a wrong chain id nobody reads is still a
  wrong chain id waiting for its first reader.
*/


// ============= INLINE PYTHON TRANSPILER =============
// This is a TypeScript implementation of the Python transpiler for direct use

interface AbiInput {
    name: string;
    type: string;
}

interface AbiEntry {
    type: string;
    name?: string;
    inputs?: AbiInput[];
    outputs?: AbiInput[];
    stateMutability?: string;
}

interface StateVariable {
    name: string;
    type: string;
    initialValue: string | number | boolean | null;
    slot: number;
    isMapping: boolean;
    keyType?: string;
    valueType?: string;
}

interface FunctionDef {
    name: string;
    params: Array<{ name: string; type: string }>;
    returnType: string;
    isPublic: boolean;
    isView: boolean;
    isPayable: boolean;
    body: string;
    selector: string;
}

interface ContractAnalysis {
    name: string;
    stateVars: StateVariable[];
    functions: FunctionDef[];
    constructorBody: string;
}

// Simple Python parser for contract structure
function parsePythonContract(code: string): ContractAnalysis | null {
    let contractName = '';
    const stateVars: StateVariable[] = [];
    const functions: FunctionDef[] = [];
    let slotCounter = 0;

    // Find class definition
    const classMatch = code.match(/class\s+(\w+)\s*\(\s*PySmartContract\s*\)/);
    if (!classMatch) {
        return null;
    }
    contractName = classMatch[1];

    // Find state variables in __init__
    const initMatch = code.match(/def\s+__init__\s*\(self\):([\s\S]*?)(?=\n\s*(?:@|def\s+\w+|$))/);
    if (initMatch) {
        const initBody = initMatch[1];

        // Find state_var calls
        const stateVarRegex = /self\.(\w+)\s*=\s*self\.state_var\s*\(\s*["'](\w+)["']\s*,\s*([^,]+)\s*,\s*["'](\w+)["']\s*\)/g;
        let match;
        while ((match = stateVarRegex.exec(initBody)) !== null) {
            stateVars.push({
                name: match[2],
                type: match[4],
                initialValue: match[3].trim(),
                slot: slotCounter++,
                isMapping: false
            });
        }

        // Find mapping calls
        const mappingRegex = /self\.(\w+)\s*=\s*self\.mapping\s*\(\s*["'](\w+)["']\s*,\s*["'](\w+)["']\s*,\s*["'](\w+)["']\s*\)/g;
        while ((match = mappingRegex.exec(initBody)) !== null) {
            stateVars.push({
                name: match[2],
                type: `mapping(${match[3]} => ${match[4]})`,
                initialValue: null,
                slot: slotCounter++,
                isMapping: true,
                keyType: match[3],
                valueType: match[4]
            });
        }
    }

    // Find functions with decorators
    // The trailing group captures the indented block so the body is translated
    // too. Emitting only signatures produced contracts that compiled but did
    // nothing at all.
    // The body group is lazy and bounded by a lookahead so the match stops at the
    // next decorator or definition. A greedy capture consumed the following
    // methods, and only the first function survived into the output.
    const funcRegex = /@(public_function|view_function|payable_function)\s*\n\s*def\s+(\w+)\s*\(self(?:,\s*([^)]*))?\)(?:\s*->\s*(\w+))?:[ \t]*\n((?:[^\n]*\n)*?)(?=[ \t]*@\w|[ \t]*def\s|[ \t]*class\s|$)/g;
    let funcMatch;
    while ((funcMatch = funcRegex.exec(code)) !== null) {
        const decorator = funcMatch[1];
        const funcName = funcMatch[2];
        const paramsStr = funcMatch[3] || '';
        const returnType = funcMatch[4] || '';
        // The capture is deliberately permissive, so cut it at the next
        // decorator or definition rather than trying to express dedent in a regex.
        const pythonBody = trimToFunctionBody(funcMatch[5] || '');

        const params: Array<{ name: string; type: string }> = [];
        if (paramsStr.trim()) {
            const paramParts = paramsStr.split(',');
            for (const part of paramParts) {
                const paramMatch = part.trim().match(/(\w+)(?:\s*:\s*(\w+))?/);
                if (paramMatch) {
                    params.push({
                        name: paramMatch[1],
                        type: paramMatch[2] || 'uint256'
                    });
                }
            }
        }

        // Compute function selector
        const paramTypes = params.map(p => pythonToSolidityType(p.type)).join(',');
        const signature = `${funcName}(${paramTypes})`;
        const selector = computeSelector(signature);

        functions.push({
            name: funcName,
            params,
            returnType: pythonToSolidityType(returnType),
            isPublic: true,
            isView: decorator === 'view_function',
            isPayable: decorator === 'payable_function',
            body: pythonBody,
            selector
        });
    }

    return {
        name: contractName,
        stateVars,
        functions,
        constructorBody: ''
    };
}

function pythonToSolidityType(pyType: string): string {
    const mapping: Record<string, string> = {
        'int': 'uint256',
        'str': 'string',
        'bool': 'bool',
        'bytes': 'bytes',
        'address': 'address',
        'uint256': 'uint256',
        'uint8': 'uint8',
        '': ''
    };
    // An absent annotation means the function returns nothing. Falling through
    // to uint256 here gave every void function a phantom return value.
    if (!pyType) return '';
    return mapping[pyType] ?? pyType;
}

/**
 * The real 4-byte selector: the first four bytes of keccak256 over the
 * canonical signature. This used to be a djb2-style string hash, which returns
 * a plausible-looking value that no client can actually call.
 */
/**
 * Reference types need an explicit data location in external signatures;
 * `returns (string)` is a compile error, `returns (string memory)` is not.
 */
function needsDataLocation(solidityType: string): boolean {
    return (
        solidityType === 'string' ||
        solidityType === 'bytes' ||
        solidityType.endsWith('[]')
    );
}

function withDataLocation(solidityType: string): string {
    return needsDataLocation(solidityType) ? `${solidityType} memory` : solidityType;
}

/**
 * Cuts a captured block at the next decorator or definition.
 *
 * Expressing "stop at a dedent" in a regular expression is fragile once blank
 * lines are allowed between methods, and getting it wrong swallowed every
 * following method into the first one's body.
 */
function trimToFunctionBody(block: string): string {
    const lines = block.split('\n');
    const body: string[] = [];

    for (const line of lines) {
        if (/^\s*@\w/.test(line) || /^\s*(def|class)\s/.test(line)) break;
        body.push(line);
    }

    return body.join('\n');
}

/** Best-effort type for a translated local. Numeric work dominates these
 *  contracts, so uint256 is the sane default and literals refine it. */
function inferLocalType(value: string): string {
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return 'string memory';
    if (value === 'true' || value === 'false') return 'bool';
    if (value === 'msg.sender' || /^address\(/.test(value)) return 'address';
    return 'uint256';
}

/**
 * The Solidity type for a parameter.
 *
 * PySmartContract templates annotate addresses as `str`, so a parameter used to
 * index an address-keyed mapping would arrive as `string memory` and refuse to
 * compile. Usage inside the body is a stronger signal than the annotation.
 */
function resolveParamType(
    param: { name: string; type: string },
    func: FunctionDef,
    analysis: ContractAnalysis
): string {
    for (const state of analysis.stateVars) {
        if (!state.isMapping || !state.keyType) continue;
        // Must name the mapping: a bare \w+ matched any mapping indexed by this
        // parameter and returned the first state variable's key type instead.
        const indexed = new RegExp(
            `\\b${state.name}\\s*(?:\\[\\s*${param.name}\\s*\\]|\\.get\\(\\s*${param.name}\\b)`
        );
        if (indexed.test(func.body)) return state.keyType;
    }

    // Address-shaped names are annotated `str` throughout the templates.
    if (/^(to|from|account|sender|recipient|spender|owner|holder)$/.test(param.name)) {
        return 'address';
    }

    return pythonToSolidityType(param.type);
}

/** Zero value for a Solidity type, used when a typed function has no body. */
function defaultValueFor(solidityType: string): string {
    if (solidityType === 'string') return '""';
    if (solidityType === 'bool') return 'false';
    if (solidityType === 'address') return 'address(0)';
    if (solidityType === 'bytes') return '""';
    return '0';
}

/**
 * Translates the PySmartContract dialect into Solidity statements.
 *
 * This handles the constructs the shipped templates use rather than being a
 * general Python compiler: state access, events, requires, returns and simple
 * assignment. Anything unrecognised is preserved as a TODO comment so the user
 * can see what still needs doing, rather than it being silently dropped.
 */
function translatePythonBody(
    body: string,
    indent = '        ',
    stateVars: StateVariable[] = []
): string[] {
    // Python binds a mapping to a local and indexes it; Solidity indexes the
    // state variable directly. Aliases are tracked so `balances = get_state(...)`
    // emits nothing and later `balances[k]` resolves to the real mapping.
    const mappingNames = new Set(stateVars.filter((v) => v.isMapping).map((v) => v.name));
    const aliases = new Map<string, string>();

    const resolveAliases = (text: string): string => {
        let result = text;

        // A mapping may be referenced by its own name without being aliased.
        for (const name of mappingNames) {
            result = result.replace(
                new RegExp(
                    `\\b${name}\\.get\\(\\s*([^,()]+?)\\s*(?:,\\s*(?:[^()]|\\([^()]*\\))*)?\\)`,
                    'g'
                ),
                `${name}[$1]`
            );
        }

        for (const [alias, target] of aliases) {
            // alias.get(key, default) -> target[key]
            result = result.replace(
                new RegExp(
                    `\\b${alias}\\.get\\(\\s*([^,()]+?)\\s*(?:,\\s*(?:[^()]|\\([^()]*\\))*)?\\)`,
                    'g'
                ),
                `${target}[$1]`
            );
            result = result.replace(new RegExp(`\\b${alias}\\[`, 'g'), `${target}[`);
        }
        return result;
    };

    const out: string[] = [];
    let inDocstring = false;

    for (const rawLine of body.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;

        const fence = line.startsWith('"""') || line.startsWith("'''");
        if (fence) {
            const doubled = line.length > 3 && (line.endsWith('"""') || line.endsWith("'''"));
            if (!doubled) inDocstring = !inDocstring;
            continue;
        }
        if (inDocstring) continue;

        if (line.startsWith('#')) {
            out.push(`${indent}//${line.slice(1)}`);
            continue;
        }

        // Binding a mapping to a local is an alias, not a statement.
        const aliasBind = line.match(/^(\w+)\s*=\s*self\.get_state\(\s*["'](\w+)["']\s*\)$/);
        if (aliasBind && mappingNames.has(aliasBind[2])) {
            aliases.set(aliasBind[1], aliasBind[2]);
            continue;
        }

        // self.set_state("name", expr)  ->  name = expr;
        const setState = line.match(/^self\.set_state\(\s*["'](\w+)["']\s*,\s*(.+?)\s*\)$/);
        if (setState) {
            out.push(`${indent}${setState[1]} = ${resolveAliases(translateExpression(setState[2]))};`);
            continue;
        }

        // return expr
        const ret = line.match(/^return\s+(.+)$/);
        if (ret) {
            out.push(`${indent}return ${resolveAliases(translateExpression(ret[1]))};`);
            continue;
        }

        // self.event("Name", a=1, b=2)  ->  emit Name(1, 2);
        const event = line.match(/^self\.event\(\s*["'](\w+)["']\s*(?:,\s*(.*))?\)$/);
        if (event) {
            const args = (event[2] || '')
                .split(',')
                .map((arg) => arg.trim())
                .filter(Boolean)
                .map((arg) => resolveAliases(translateExpression(arg.replace(/^\w+\s*=\s*/, ''))));
            out.push(`${indent}emit ${event[1]}(${args.join(', ')});`);
            continue;
        }

        // self.require(cond, "msg")  ->  require(cond, "msg");
        const selfRequire = line.match(/^self\.require\(\s*(.+)\s*\)$/);
        if (selfRequire) {
            out.push(`${indent}require(${resolveAliases(translateExpression(selfRequire[1]))});`);
            continue;
        }

        // assert cond, "msg"  ->  require(cond, "msg");
        const assertion = line.match(/^assert\s+(.+?)(?:\s*,\s*(["'].*["']))?$/);
        if (assertion) {
            const message = assertion[2] ? `, ${assertion[2]}` : '';
            out.push(`${indent}require(${resolveAliases(translateExpression(assertion[1]))}${message});`);
            continue;
        }

        // self.name = expr  ->  name = expr;
        const assign = line.match(/^self\.(\w+)\s*(\+=|-=|=)\s*(.+)$/);
        if (assign) {
            out.push(`${indent}${assign[1]} ${assign[2]} ${resolveAliases(translateExpression(assign[3]))};`);
            continue;
        }

        // alias[key] = value  ->  mapping[key] = value;
        const indexed = line.match(/^(\w+)\[(.+?)\]\s*(\+=|-=|=)\s*(.+)$/);
        if (indexed && aliases.has(indexed[1])) {
            const target = aliases.get(indexed[1]);
            out.push(
                `${indent}${target}[${resolveAliases(translateExpression(indexed[2]))}] ` +
                `${indexed[3]} ${resolveAliases(translateExpression(indexed[4]))};`
            );
            continue;
        }

        // A bare `name = expr` is a Python local; Solidity needs a declaration.
        const local = line.match(/^(\w+)\s*=\s*(.+)$/);
        if (local && !line.startsWith('self.')) {
            const value = translateExpression(local[2]);
            const resolved = resolveAliases(value);
            out.push(`${indent}${inferLocalType(resolved)} ${local[1]} = ${resolved};`);
            continue;
        }

        out.push(`${indent}// TODO: unsupported statement: ${line}`);
    }

    return out;
}

/** Rewrites PySmartContract expression helpers into their Solidity equivalents. */
function translateExpression(expr: string): string {
    return expr
        .replace(/self\.get_state\(\s*["'](\w+)["']\s*\)/g, '$1')
        .replace(/self\.msg_sender\(\)/g, 'msg.sender')
        .replace(/self\.msg_value\(\)/g, 'msg.value')
        .replace(/self\.block_timestamp\(\)/g, 'block.timestamp')
        .replace(/self\.block_number\(\)/g, 'block.number')
        .replace(/self\.(\w+)/g, '$1')
        .replace(/["']0x0+["']/g, 'address(0)')
        .replace(/\bTrue\b/g, 'true')
        .replace(/\bFalse\b/g, 'false')
        .replace(/\bNone\b/g, '0')
        .replace(/\band\b/g, '&&')
        .replace(/\bor\b/g, '||')
        .trim();
}

function computeSelector(signature: string): string {
    return keccak256(toHex(signature)).slice(0, 10);
}

function generateSolidity(analysis: ContractAnalysis): string {
    const lines: string[] = [];

    lines.push('// SPDX-License-Identifier: MIT');
    lines.push('// Generated by PyMon Transpiler for Monsmith');
    lines.push('pragma solidity ^0.8.20;');
    lines.push('');
    lines.push(`contract ${analysis.name} {`);

    // State variables
    for (const v of analysis.stateVars) {
        if (v.isMapping) {
            lines.push(`    ${v.type} public ${v.name};`);
        } else {
            const initial = formatInitialValue(v.initialValue, v.type);
            if (initial && initial !== '0' && initial !== '""') {
                lines.push(`    ${v.type} public ${v.name} = ${initial};`);
            } else {
                lines.push(`    ${v.type} public ${v.name};`);
            }
        }
    }
    lines.push('');

    // Events the translated bodies emit must be declared before use.
    const eventDeclarations = collectEvents(analysis);
    if (eventDeclarations.length > 0) {
        lines.push(...eventDeclarations);
        lines.push('');
    }

    // Constructor
    lines.push('    constructor() {');
    lines.push('        // Initialize state');
    lines.push('    }');
    lines.push('');

    // Functions
    for (const func of analysis.functions) {
        const visibility = 'public';
        const modifiers: string[] = [];
        if (func.isView) modifiers.push('view');
        if (func.isPayable) modifiers.push('payable');

        const params = func.params
            .map(p => `${withDataLocation(resolveParamType(p, func, analysis))} ${p.name}`)
            .join(', ');

        // A Python annotation is a hint; the state variable's declared type is
        // the truth. Templates annotate an address getter as `-> str`, which
        // would emit `returns (string memory)` around an address and refuse to
        // compile, so the returned variable's own type wins.
        const returnType = resolveReturnType(func, analysis);
        const returns = returnType ? ` returns (${withDataLocation(returnType)})` : '';
        const mods = modifiers.length > 0 ? ' ' + modifiers.join(' ') : '';

        lines.push(`    function ${func.name}(${params}) ${visibility}${mods}${returns} {`);
        const bodyLines = translatePythonBody(func.body, '        ', analysis.stateVars);
        if (bodyLines.length > 0) {
            lines.push(...bodyLines);
        } else if (returnType) {
            // A typed function with nothing to translate must still return.
            lines.push(`        return ${defaultValueFor(returnType)};`);
        }
        lines.push('    }');
        lines.push('');
    }

    // Receive function
    if (analysis.functions.some(f => f.isPayable)) {
        lines.push('    receive() external payable {}');
    }

    lines.push('}');

    return lines.join('\n');
}

function formatInitialValue(value: string | number | boolean | null | undefined, type: string): string {
    if (value === null || value === undefined) return '0';

    const valueStr = String(value).trim();

    if (valueStr.includes('self.msg_sender()')) {
        return 'msg.sender';
    }
    if (type === 'string') {
        if (valueStr.startsWith('"') || valueStr.startsWith("'")) {
            return valueStr.replace(/'/g, '"');
        }
        return `"${valueStr}"`;
    }
    if (type === 'bool') {
        return valueStr.toLowerCase() === 'true' ? 'true' : 'false';
    }
    return valueStr;
}

/**
 * Collects the events the translated bodies emit so they can be declared.
 *
 * `emit X(...)` without a matching `event X(...)` is a compile error, so the
 * declarations are derived from the same call sites the emits come from.
 * Argument types are inferred from the function's parameters and the contract's
 * state variables, falling back to uint256.
 */
/**
 * The Solidity return type for a translated function.
 *
 * When the body returns a state variable directly, that variable's declared
 * type is used in preference to the Python annotation, which is frequently
 * approximate (`-> str` for an address getter, for example).
 */
function resolveReturnType(func: FunctionDef, analysis: ContractAnalysis): string {
    if (!func.returnType) return '';

    // Returning a mapping element yields the mapping's value type, not the
    // mapping's own type, and not the approximate Python annotation.
    const mapped = func.body.match(/return\s+(\w+)(?:\.get\(|\[)/);
    if (mapped) {
        const state = analysis.stateVars.find((v) => v.name === mapped[1] && v.isMapping);
        if (state?.valueType) return state.valueType;
    }

    const returned = func.body.match(/return\s+self\.get_state\(\s*["'](\w+)["']\s*\)/)
        ?? func.body.match(/return\s+self\.(\w+)/);

    if (returned) {
        const state = analysis.stateVars.find((v) => v.name === returned[1]);
        if (state) return state.type;
    }

    return func.returnType;
}

function collectEvents(analysis: ContractAnalysis): string[] {
    const declarations = new Map<string, string>();

    const typeOfIdentifier = (name: string, func: FunctionDef): string => {
        const param = func.params.find((p) => p.name === name);
        if (param) return resolveParamType(param, func, analysis);
        const state = analysis.stateVars.find((v) => v.name === name);
        if (state) return state.type;
        if (name === 'sender' || name.endsWith('_address') || name === 'msg.sender') return 'address';
        return 'uint256';
    };

    for (const func of analysis.functions) {
        const pattern = /self\.event\(\s*["'](\w+)["']\s*(?:,\s*([^\n]*))?\)/g;
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(func.body)) !== null) {
            const eventName = match[1];
            if (declarations.has(eventName)) continue;

            const args = (match[2] || '')
                .split(',')
                .map((arg) => arg.trim())
                .filter(Boolean)
                .map((arg) => {
                    const [label, value] = arg.includes('=') ? arg.split('=') : [arg, arg];
                    const argName = label.trim();
                    // Type the value as it will actually be emitted; "0x0" becomes
                    // address(0), so typing the raw literal declared it a string.
                    const source = translateExpression((value ?? argName).trim());
                    if (source === 'address(0)') return `address ${argName}`;
                    const isStringLiteral = /^".*"$/.test(source) || /^'.*'$/.test(source);
                    const solType = isStringLiteral
                        ? 'string'
                        : source.includes('msg_sender')
                          ? 'address'
                          : typeOfIdentifier(source, func);
                    return `${solType} ${argName}`;
                });

            declarations.set(eventName, `    event ${eventName}(${args.join(', ')});`);
        }
    }

    return [...declarations.values()];
}

function generateABI(analysis: ContractAnalysis): AbiEntry[] {
    const abi: AbiEntry[] = [];

    // Constructor
    abi.push({
        type: 'constructor',
        inputs: [],
        stateMutability: 'nonpayable'
    });

    // Functions
    for (const func of analysis.functions) {
        abi.push({
            type: 'function',
            name: func.name,
            inputs: func.params.map(p => ({
                name: p.name,
                type: pythonToSolidityType(p.type)
            })),
            outputs: func.returnType ? [{ name: '', type: func.returnType }] : [],
            stateMutability: func.isPayable ? 'payable' : (func.isView ? 'view' : 'nonpayable')
        });
    }

    // State variable getters
    for (const v of analysis.stateVars) {
        if (!v.isMapping) {
            abi.push({
                type: 'function',
                name: v.name,
                inputs: [],
                outputs: [{ name: '', type: v.type }],
                stateMutability: 'view'
            });
        }
    }

    // Receive
    if (analysis.functions.some(f => f.isPayable)) {
        abi.push({
            type: 'receive',
            stateMutability: 'payable'
        });
    }

    return abi;
}

// ============= SECURITY AUDITOR =============

interface AuditFinding {
    type: string;
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    title: string;
    description: string;
    line?: number;
    recommendation: string;
}

function auditPythonContract(code: string): {
    score: number;
    riskLevel: string;
    findings: AuditFinding[];
    summary: string;
} {
    const findings: AuditFinding[] = [];
    const lines = code.split('\n');

    // Check for access control
    let hasAccessControl = false;
    let hasStateModification = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // Check for require with owner check
        if (line.includes('self.require') && (line.includes('owner') || line.includes('msg_sender'))) {
            hasAccessControl = true;
        }

        // Check for state modification
        if (line.includes('set_state')) {
            hasStateModification = true;
        }

        // Check for hardcoded addresses
        const addressMatch = line.match(/0x[a-fA-F0-9]{40}/);
        if (addressMatch && addressMatch[0] !== '0x0000000000000000000000000000000000000000') {
            findings.push({
                type: 'hardcoded_address',
                severity: 'medium',
                title: 'Hardcoded Address',
                description: `Hardcoded address found: ${addressMatch[0]}`,
                line: lineNum,
                recommendation: 'Use configurable addresses or constructor parameters'
            });
        }

        // Check for timestamp dependence
        if (line.includes('block_timestamp')) {
            findings.push({
                type: 'timestamp_dependence',
                severity: 'medium',
                title: 'Timestamp Dependence',
                description: 'Contract relies on block timestamp',
                line: lineNum,
                recommendation: 'Avoid using timestamps for critical logic'
            });
        }

        // Check for unbounded loops
        if (line.includes('for ') && !line.includes('range(')) {
            findings.push({
                type: 'unbounded_loop',
                severity: 'high',
                title: 'Potential Unbounded Loop',
                description: 'Loop without explicit bounds detected',
                line: lineNum,
                recommendation: 'Use bounded iteration or pagination'
            });
        }
    }

    // Check for missing access control on state-modifying functions
    const publicFuncMatch = code.match(/@public_function[\s\S]*?def\s+(\w+)/g);
    if (publicFuncMatch && hasStateModification && !hasAccessControl) {
        findings.push({
            type: 'access_control',
            severity: 'high',
            title: 'Missing Access Control',
            description: 'Public functions modify state without access control',
            recommendation: 'Add owner/admin checks using self.require()'
        });
    }

    // Check for missing events
    if (hasStateModification && !code.includes('self.event(')) {
        findings.push({
            type: 'missing_events',
            severity: 'low',
            title: 'Missing Event Emissions',
            description: 'State-changing functions should emit events',
            recommendation: 'Add self.event() calls for all state changes'
        });
    }

    // Calculate score
    let score = 100;
    for (const finding of findings) {
        if (finding.severity === 'critical') score -= 25;
        else if (finding.severity === 'high') score -= 15;
        else if (finding.severity === 'medium') score -= 10;
        else if (finding.severity === 'low') score -= 5;
    }
    score = Math.max(0, score);

    const riskLevel = score >= 90 ? 'LOW' : (score >= 70 ? 'MEDIUM' : (score >= 50 ? 'HIGH' : 'CRITICAL'));

    return {
        score,
        riskLevel,
        findings,
        summary: `Security Score: ${score}/100 | Risk Level: ${riskLevel} | Issues: ${findings.length}`
    };
}

// ============= API HANDLER =============

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { action, code } = body;


        if (!code) {
            return NextResponse.json({
                success: false,
                error: 'Missing code in request'
            }, { status: 400 });
        }

        switch (action) {
            case 'compile': {
                // Parse and transpile Python to Solidity
                const analysis = parsePythonContract(code);

                if (!analysis) {
                    return NextResponse.json({
                        success: false,
                        error: 'Invalid Python contract. Must inherit from PySmartContract.',
                        stage: 'parsing'
                    }, { status: 400 });
                }

                const solidityCode = generateSolidity(analysis);
                const abi = generateABI(analysis);

                return NextResponse.json({
                    success: true,
                    contractName: analysis.name,
                    abi,
                    bytecode: '', // Will be compiled by Solidity compiler
                    solidityCode,
                    requiresSolidityCompilation: true,
                    metadata: {
                        compiler: 'pymon',
                        stateVariables: analysis.stateVars,
                        functions: analysis.functions.map(f => ({
                            name: f.name,
                            selector: f.selector,
                            visibility: 'public',
                            stateMutability: f.isPayable ? 'payable' : (f.isView ? 'view' : 'nonpayable')
                        }))
                    }
                });
            }

            case 'transpile': {
                const analysis = parsePythonContract(code);

                if (!analysis) {
                    return NextResponse.json({
                        success: false,
                        error: 'Invalid Python contract'
                    }, { status: 400 });
                }

                return NextResponse.json({
                    success: true,
                    solidity: generateSolidity(analysis),
                    contractName: analysis.name,
                    abi: generateABI(analysis)
                });
            }

            case 'validate': {
                const isValid = code.includes('PySmartContract') &&
                    (code.includes('@public_function') || code.includes('@view_function'));

                const classMatch = code.match(/class\s+(\w+)\s*\(/g);
                const contracts = classMatch ? classMatch.map((m: string) => m.replace(/class\s+|\s*\(/g, '')) : [];

                return NextResponse.json({
                    valid: isValid,
                    contracts,
                    message: isValid ? 'Valid PyMon contract' : 'Invalid contract structure'
                });
            }

            case 'audit': {
                const result = auditPythonContract(code);

                return NextResponse.json({
                    success: true,
                    ...result
                });
            }

            default:
                return NextResponse.json({
                    success: false,
                    error: `Unknown action: ${action}`
                }, { status: 400 });
        }

    } catch (error) {
            const message = error instanceof Error ? error.message : "Unexpected server error";
        console.error(`[pymon] ${message}`);
        return NextResponse.json({
            success: false,
            error: message || 'Internal server error'
        }, { status: 500 });
    }
}

export async function GET() {
    // What this route answers to, for anyone who finds it. The two actions it
    // used to serve here were dropped with the data behind them.
    return NextResponse.json({
        success: true,
        service: 'PyMon API',
        version: '1.0.0',
        endpoints: {
            'POST /compile': 'Compile Python to EVM bytecode',
            'POST /transpile': 'Transpile Python to Solidity',
            'POST /validate': 'Validate Python contract',
            'POST /audit': 'Security audit',
        }
    });
}
