/**
 * Building a Contract Report.
 *
 * This is the only place that knows how to turn a pile of Solidity into the
 * artifact `lib/report/types.ts` describes. It owns three jobs and nothing else:
 * deciding which files are worth auditing, running the four existing engines
 * against each of them, and rolling the results into one score a reader can act
 * on.
 *
 * It is an async generator rather than a function that returns a report because
 * the work outlasts a request. A twelve contract repository is a minute or two
 * of solc and local EVM time, and a progress bar that only moves at the end is
 * indistinguishable from a hang. Yielding each section as it lands lets the rail
 * fill while the rest is still being measured, and it costs nothing: the caller
 * that wants the whole thing simply reads to the `complete` event.
 *
 * The engines are imported directly rather than reached over HTTP. Calling our
 * own routes would double the serialisation, lose the types, and make a report
 * depend on the deployment being able to reach itself, which is exactly the kind
 * of thing that works locally and fails in preview.
 *
 * Every section is fallible by design. A contract that will not compile still
 * gets its security and parallel sections, and the sections that could not run
 * say why. Silence would read as a pass, and a report that quietly omits what it
 * could not measure is worse than no report.
 */

import { deepAudit, fixReview, toFindings, type DeepAudit, type FixReviewInput } from './audit';
import { isChainId, type ChainId } from '../chainfit/chains';
import type { ChainFinding } from '../chainfit/findings';
import { buildChainFitReport, type ChainFitReport } from '../chainfit/report';
import { buildGasProfile, type FunctionGas, type GasProfile } from '../gasProfiler';
import { classifySolidityPath, isInterfaceOnly, MAX_FILE_BYTES } from '../github/source';
import {
    analyzeParallelPotential,
    type Hotspot,
    type OptimizationSuggestion,
    type ParallelAnalysisResult,
} from '../parallel/analyzer';
import { keccak256, toBytes } from 'viem';

import { flattenImportClosure } from '../flatten';
import { compileVersioned } from '../solc/compile';
import {
    CONTRACT_BUDGET_MS,
    CONTRACTS_PER_RUN,
    countBySeverity,
    emptyCounts,
    gradeFor,
    isOk,
    pending,
    SEVERITY_WEIGHT,
    type ContractReport,
    type ContractSections,
    type Finding,
    type Health,
    type RepoReport,
    type ReportEvent,
    type ReportOrigin,
    type Section,
    type SecurityAnalysis,
    type Severity,
    type SeverityCounts,
    type SkippedContract,
    type SkipReason,
} from './types';

export interface BuildInput {
    /** Workspace-relative path to source. Non-Solidity entries are ignored. */
    files: Record<string, string>;
    /**
     * Audit only these paths, when the caller chose a subset.
     *
     * Every file still reaches the compiler, because a contract that imports a
     * sibling cannot be compiled without it. This narrows what is audited, not
     * what is available to solc, and those are different questions that a
     * single list would have conflated.
     */
    only?: readonly string[];
    origin: ReportOrigin;
    /** Contracts audited in this report, from the viewer's tier. */
    cap: number;
    /** Chain ids for the chain fit comparison. Unknown ids are dropped. */
    chains?: string[];
    /**
     * Re-audit one contract as a fix review rather than from scratch.
     *
     * Set by the optimizer: the earlier AI findings are re-checked against the
     * new code one by one, so a fix is credited only for what it resolved, and
     * the fixed contract is audited again in full with every new finding
     * labelled by where it sits.
     */
    fixReview?: { path: string } & FixReviewInput;
    /**
     * Fix reviews for several contracts, keyed by path.
     *
     * Set by the pull request review: a push that changes a contract already
     * reviewed on that pull request is checked against the earlier findings,
     * which is what lets the comment say which of them the push fixed.
     */
    fixReviews?: Readonly<Record<string, FixReviewInput>>;
    /**
     * Contract reports to reuse as they are, keyed by path.
     *
     * Used only when the source is byte for byte what was audited, which the
     * stored source hash proves. A pull request that pushes a fix to one
     * contract should not pay for, or wait on, a second audit of the five it
     * did not touch.
     */
    reuse?: Readonly<Record<string, ContractReport>>;
}

// ============= SECURITY =============

/**
 * The static checks, lifted out of `app/api/security/route.ts`.
 *
 * They live here as data rather than as a chain of `if` statements so the report
 * and the route cannot drift apart silently: a rule is a row, and adding one is
 * adding a row. The route itself is left alone deliberately. It is a working
 * public endpoint with its own response shape, and rewriting it to import from
 * here would be a second track's change smuggled into this one.
 *
 * `anchor` is the only addition. The route reports no line numbers because its
 * consumer renders a list; a report finding points at a file, so the first
 * occurrence of the pattern that fired is worth recording.
 */
/** A public mint, burn or withdraw, captured up to its opening brace. */
const PRIVILEGED_FUNCTION = /\bfunction\s+((?:mint|burn|withdraw)\w*)\s*\(([^)]*)\)([^{;]*)\{/g;
const UNGUARDED_PRIVILEGED = /\bfunction\s+(?:mint|burn|withdraw)\w*\s*\(/;
const NOT_A_GUARD = new Set(['public', 'external', 'internal', 'private', 'view', 'pure', 'payable', 'virtual', 'override', 'returns']);

/** The body of the function whose opening brace is at `open`. */
function bodyFrom(code: string, open: number): string {
    let depth = 0;
    for (let index = open; index < code.length; index++) {
        if (code[index] === '{') depth += 1;
        else if (code[index] === '}') {
            depth -= 1;
            if (depth === 0) return code.slice(open + 1, index);
        }
    }
    return code.slice(open + 1);
}

/**
 * The first mint, burn or withdraw that anyone can call to act on funds that
 * are not their own, or null.
 *
 * The rule used to fire on any contract with such a function and no Ownable,
 * which marks WETH9 high for letting people withdraw their own deposit. A
 * function is fine when a modifier guards it, when its body checks the caller,
 * or when it only touches the caller's own funds: it uses msg.sender and takes
 * no address to act on someone else.
 */
function unguardedPrivileged(code: string): string | null {
    for (const match of code.matchAll(PRIVILEGED_FUNCTION)) {
        const [whole, name, params, header] = match;
        if (/\b(?:internal|private|view|pure)\b/.test(header)) continue;
        const modifiers = header.match(/\b[A-Za-z_]\w*\b/g) ?? [];
        if (modifiers.some((word) => !NOT_A_GUARD.has(word) && !/^(?:uint|int|bool|address|bytes|string)\d*$/.test(word))) continue;
        const body = bodyFrom(code, (match.index ?? 0) + whole.length - 1);
        if (/msg\.sender\s*==|==\s*msg\.sender|hasRole\s*\(|_checkOwner\s*\(|_checkRole\s*\(/.test(body)) continue;
        if (body.includes('msg.sender') && !/\baddress\b/.test(params)) continue;
        return name;
    }
    return null;
}

interface SecurityRule {
    severity: Severity;
    title: string;
    description: string;
    recommendation: string;
    /** Where in the source to point the reader, when the rule has a giveaway. */
    anchor?: RegExp;
    /** `code` has comments blanked out; `source` is untouched, for the rules that read comments. */
    applies(code: string, source: string): boolean;
}

const SECURITY_RULES: readonly SecurityRule[] = [
    {
        severity: 'critical',
        title: 'Potential Reentrancy Vulnerability',
        description: 'Contract uses low-level call with value without reentrancy protection',
        recommendation:
            "Import and use OpenZeppelin's ReentrancyGuard modifier on external functions that transfer value",
        anchor: /\.call\{value:/,
        applies: (code) =>
            code.includes('.call{value:') &&
            !code.includes('ReentrancyGuard') &&
            !code.includes('nonReentrant'),
    },
    {
        severity: 'high',
        title: 'Unchecked External Call',
        description: 'External calls should always check return values',
        recommendation: 'Add require() or if-revert checks after external calls',
        anchor: /\.(?:delegate)?call\(/,
        applies: (code) =>
            (code.includes('.call(') || code.includes('.delegatecall(')) &&
            !code.includes('require') &&
            !code.includes('revert'),
    },
    {
        severity: 'high',
        title: 'Use of tx.origin for Authorization',
        description:
            "tx.origin should not be used for authorization as it's vulnerable to phishing attacks",
        recommendation: 'Use msg.sender instead of tx.origin',
        anchor: /tx\.origin/,
        applies: (code) => code.includes('tx.origin'),
    },
    {
        severity: 'critical',
        title: 'Integer Overflow/Underflow Risk',
        description: 'Solidity < 0.8.0 requires SafeMath library for arithmetic operations',
        recommendation: "Upgrade to Solidity ^0.8.0 or use OpenZeppelin's SafeMath",
        anchor: /pragma solidity/,
        applies: (code) => {
            const pragma = /pragma solidity \^?(\d+\.\d+)/.exec(code);
            if (pragma === null) return false;
            return Number.parseFloat(pragma[1]) < 0.8 && !code.includes('SafeMath');
        },
    },
    {
        severity: 'high',
        title: 'Missing Access Control',
        description: 'Privileged functions detected without proper access control',
        recommendation:
            "Import OpenZeppelin's Ownable or AccessControl and protect sensitive functions",
        anchor: UNGUARDED_PRIVILEGED,
        applies: (code) => unguardedPrivileged(code) !== null,
    },
    {
        severity: 'medium',
        title: 'Potential DoS with Unbounded Loop',
        description: 'Loops over dynamic arrays can run out of gas',
        recommendation: 'Add limits to array sizes or implement pagination',
        anchor: /for\s*\(/,
        applies: (code) => /for\s*\(/.test(code) && code.includes('.length'),
    },
    {
        severity: 'medium',
        title: 'Missing Event Emission',
        description: 'State-changing functions should emit events',
        recommendation: 'Add event declarations and emit them in critical functions',
        anchor: /function transfer\(/,
        applies: (code) => code.includes('function transfer(') && !code.includes('emit Transfer'),
    },
    {
        severity: 'low',
        title: 'Floating Pragma',
        description:
            'Using ^ allows compilation with future compiler versions that may have bugs',
        recommendation: 'Lock pragma to a specific version for production contracts',
        anchor: /pragma solidity \^/,
        applies: (code) => code.includes('pragma solidity ^'),
    },
    {
        severity: 'low',
        title: 'Block Timestamp Dependency',
        description: 'Block timestamps can be manipulated by miners within a short range',
        recommendation:
            'Avoid using timestamps for critical logic or accept ~15 second variance',
        anchor: /\bblock\.timestamp\b|\bnow\b/,
        // A word test, not a substring one: "now" inside "known" is not a clock.
        applies: (code) => /\bblock\.timestamp\b|\bnow\b/.test(code),
    },
    {
        severity: 'medium',
        title: 'Missing Function Visibility',
        description:
            'Functions without explicit visibility are public by default in older versions',
        recommendation: 'Explicitly declare visibility for all functions',
        applies: (code) => {
            const declarations = code.match(
                /function\s+\w+\s*\([^)]*\)\s*(?:public|private|internal|external)?/g,
            );
            if (declarations === null) return false;
            return declarations.some(
                (declaration) =>
                    !declaration.includes('public') &&
                    !declaration.includes('private') &&
                    !declaration.includes('internal') &&
                    !declaration.includes('external'),
            );
        },
    },
    {
        severity: 'info',
        title: 'Uses OpenZeppelin Contracts',
        description: 'Contract uses battle-tested OpenZeppelin libraries',
        recommendation: 'Good practice, keep using audited libraries',
        applies: (code) => code.includes('@openzeppelin/contracts'),
    },
    {
        severity: 'low',
        title: 'Missing SPDX License Identifier',
        description: 'All source files should specify a license',
        recommendation: 'Add // SPDX-License-Identifier: MIT at the top of the file',
        // The licence line is a comment, so this one reads the source as written.
        applies: (_code, source) => !source.includes('SPDX-License-Identifier'),
    },
    {
        severity: 'critical',
        title: 'Use of selfdestruct',
        description: 'selfdestruct can permanently destroy contract and funds',
        recommendation:
            'Remove selfdestruct or add multiple layers of access control with timelock',
        anchor: /selfdestruct|suicide/,
        applies: (code) => code.includes('selfdestruct') || code.includes('suicide'),
    },
    {
        severity: 'info',
        title: 'No Constructor Defined',
        description: 'Contract has no constructor for initialization',
        recommendation: 'Add constructor if initial setup is needed',
        applies: (code) => !code.includes('constructor('),
    },
];

/** What each severity costs the route's 0-100 security score. */
const RISK_WEIGHT: Readonly<Record<Severity, number>> = {
    critical: 10,
    high: 7,
    medium: 4,
    low: 2,
    info: 0,
};

/** 1-based line of the first match, so a finding can open the right place. */
function lineOf(code: string, anchor: RegExp | undefined): number | undefined {
    if (anchor === undefined) return undefined;
    const match = anchor.exec(code);
    if (match === null) return undefined;
    return code.slice(0, match.index).split('\n').length;
}

/**
 * Source with comments blanked out but every line kept, so the rules read code
 * rather than prose and the lines they report still point at the right place.
 * Without this, a comment that mentions tx.origin was a high finding.
 */
function withoutComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
        .replace(/\/\/[^\n]*/g, (comment) => ' '.repeat(comment.length));
}

function analyzeSecurity(source: string): SecurityAnalysis {
    const code = withoutComments(source);
    const issues = SECURITY_RULES.filter((rule) => rule.applies(code, source)).map((rule) => ({
        severity: rule.severity,
        title: rule.title,
        description: rule.description,
        recommendation: rule.recommendation,
        line: lineOf(code, rule.anchor),
    }));

    const risk = issues.reduce((total, issue) => total + RISK_WEIGHT[issue.severity], 0);

    return { issues, score: Math.max(0, Math.min(100, 100 - risk)) };
}

// ============= FINDINGS FROM EACH ENGINE =============

/**
 * A parallel hotspot is not a vulnerability, so it is graded a step below what
 * its own scale calls it. Contention costs throughput, and the health score
 * already pays attention to throughput through the parallel blend below. Grading
 * a hot counter as "high" would charge for it twice and bury a real bug under
 * performance advice.
 */
const HOTSPOT_SEVERITY: Readonly<Record<Hotspot['severity'], Severity>> = {
    high: 'medium',
    medium: 'low',
    low: 'info',
};

/** Chain fit speaks in consequences rather than severities, so map the intent. */
const CHAIN_IMPACT_SEVERITY: Readonly<Record<ChainFinding['impact'], Severity>> = {
    blocker: 'high',
    cost: 'medium',
    design: 'low',
    advantage: 'info',
    info: 'info',
};

function securityFindings(path: string, analysis: SecurityAnalysis): Array<Omit<Finding, 'id'>> {
    return analysis.issues.map((issue) => ({
        severity: issue.severity,
        title: issue.title,
        source: 'security' as const,
        file: path,
        line: issue.line,
        description: issue.description,
        fix: issue.recommendation,
    }));
}

function hotspotFinding(path: string, hotspot: Hotspot): Omit<Finding, 'id'> {
    const writers =
        hotspot.writers.length > 0
            ? ` Written by ${hotspot.writers.join(', ')}.`
            : '';

    return {
        severity: HOTSPOT_SEVERITY[hotspot.severity],
        title: `Storage contention on ${hotspot.variable}`,
        source: 'parallel',
        file: path,
        line: hotspot.line,
        description: `${hotspot.impact}${writers}`,
        fix:
            hotspot.accumulator
                ? 'Shard the counter across slots and sum on read, so concurrent writers stop colliding.'
                : `Narrow the addressing of ${hotspot.variable} so two transactions only meet when they mean to.`,
    };
}

function suggestionFinding(
    path: string,
    suggestion: OptimizationSuggestion,
): Omit<Finding, 'id'> {
    return {
        // A suggestion is advice, never a defect. It is recorded at the lowest
        // severity so it shows up in the report without moving the score.
        severity: 'info',
        title: suggestion.title,
        source: 'parallel',
        file: path,
        description: `${suggestion.description} ${suggestion.impact}`,
        evidence: suggestion.currentCode,
        fix: suggestion.suggestedCode,
    };
}

function parallelFindings(
    path: string,
    analysis: ParallelAnalysisResult,
): Array<Omit<Finding, 'id'>> {
    // Contended slots repeat the same sentence per variable for the same
    // reason gas findings did, so they group above the same threshold.
    const hotspots =
        analysis.hotspots.length > GROUP_ABOVE
            ? [
                  {
                      severity: 'medium' as const,
                      title: `${plural(analysis.hotspots.length, 'storage slot')} serialise this contract`,
                      source: 'parallel' as const,
                      file: path,
                      description: `Every write to these forces the entrypoints touching them into a queue on Monad: ${analysis.hotspots
                          .slice(0, 12)
                          .map((hotspot) => hotspot.variable)
                          .join(', ')}${analysis.hotspots.length > 12 ? `, and ${analysis.hotspots.length - 12} more` : ''}.`,
                      fix: 'Key the state by the caller where the value is theirs, or split a shared counter into stripes that sum back.',
                  },
              ]
            : analysis.hotspots.map((hotspot) => hotspotFinding(path, hotspot));

    const suggestions = analysis.suggestions
        // "Already optimal" is a verdict, not a finding, and the score says it.
        .filter((suggestion) => suggestion.type !== 'already_optimal')
        .map((suggestion) => suggestionFinding(path, suggestion));

    return [...hotspots, ...suggestions];
}

function gasFinding(path: string, fn: FunctionGas): Omit<Finding, 'id'> {
    const unbounded = fn.classification === 'unbounded';

    return {
        severity: unbounded ? 'medium' : 'low',
        title: unbounded
            ? `${fn.name} has no gas bound`
            : `${fn.name} costs about ${fn.gas?.toLocaleString('en-US') ?? 'an unknown amount of'} gas`,
        source: 'gas',
        file: path,
        description: unbounded
            ? `solc could not bound ${fn.signature}, which means its cost depends on a loop whose length is decided at runtime. A caller can make it exceed the block gas limit.`
            : `${fn.signature} is above the threshold where cost becomes something users notice.`,
        fix: fn.hint ?? undefined,
    };
}

/**
 * Gas findings, grouped rather than one per function.
 *
 * Emitting a finding for every unbounded function is how a report ends up
 * claiming three hundred and ten medium issues. On a forty function contract
 * that is forty near-identical rows saying the same sentence about a different
 * name, and the three findings that actually matter are buried somewhere in the
 * middle of them. A reader stops reading, which costs more than missing a
 * finding would.
 *
 * Firms that do this for a living write it once and list the sites. Below the
 * threshold each one is still worth its own row, because a report with two
 * unbounded functions should name them rather than making you expand a group.
 */
const GROUP_ABOVE = 3;

function groupedGasFinding(
    path: string,
    functions: readonly FunctionGas[],
    kind: 'unbounded' | 'expensive',
): Omit<Finding, 'id'> {
    const names = functions.map((fn) => fn.name);
    const shown = names.slice(0, 12).join(', ');
    const rest = names.length > 12 ? `, and ${names.length - 12} more` : '';

    return {
        severity: kind === 'unbounded' ? 'medium' : 'low',
        title:
            kind === 'unbounded'
                ? `${plural(functions.length, 'function')} have no gas bound`
                : `${plural(functions.length, 'function')} cost enough gas to notice`,
        source: 'gas',
        file: path,
        description:
            kind === 'unbounded'
                ? `solc could not bound these, so their cost depends on a loop whose length is decided at runtime and a caller can push them past the block gas limit: ${shown}${rest}.`
                : `These are above the threshold where cost becomes something users notice: ${shown}${rest}.`,
        fix:
            kind === 'unbounded'
                ? 'Bound the loops, or let callers process a range they choose so the work per transaction is theirs to cap.'
                : 'Look for storage reads inside loops and values that could be cached in memory.',
    };
}

function gasFindings(path: string, profile: GasProfile): Array<Omit<Finding, 'id'>> {
    const unbounded = profile.functions.filter((fn) => fn.classification === 'unbounded');
    const expensive = profile.functions.filter((fn) => fn.classification === 'expensive');

    const out: Array<Omit<Finding, 'id'>> = [];
    for (const [group, kind] of [
        [unbounded, 'unbounded'],
        [expensive, 'expensive'],
    ] as const) {
        if (group.length === 0) continue;
        if (group.length > GROUP_ABOVE) out.push(groupedGasFinding(path, group, kind));
        else out.push(...group.map((fn) => gasFinding(path, fn)));
    }
    return out;
}

function chainFitFindings(path: string, report: ChainFitReport): Array<Omit<Finding, 'id'>> {
    return report.findings.map((finding) => {
        const affects =
            finding.affects.length > 0 ? ` Affects ${finding.affects.join(', ')}.` : '';
        const metric =
            finding.metric === null ? '' : ` ${finding.metric.label}: ${finding.metric.value}.`;

        return {
            severity: CHAIN_IMPACT_SEVERITY[finding.impact],
            title: finding.title,
            source: 'chainfit' as const,
            file: path,
            description: `${finding.detail}${affects}${metric}`,
            fix: finding.action ?? undefined,
        };
    });
}

/** Stable within a report, which is all the client and the redactor need. */
function withIds(
    contractId: string,
    source: Finding['source'],
    findings: Array<Omit<Finding, 'id'>>,
): Finding[] {
    return findings.map((finding, index) => ({
        ...finding,
        id: `${contractId}:${source}:${index}`,
    }));
}

// ============= PLANNING =============

interface PlannedContract {
    id: string;
    path: string;
    source: string;
    /** Public and external function declarations. The cap ranks on this. */
    entrypoints: number;
    bytes: number;
}

interface Plan {
    planned: PlannedContract[];
    skipped: SkippedContract[];
    notes: string[];
}

function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const ENTRYPOINT_PATTERN = /\bfunction\s+[A-Za-z_]\w*\s*\([^)]*\)[^;{]*\b(?:external|public)\b/g;

function countEntrypoints(source: string): number {
    return stripComments(source).match(ENTRYPOINT_PATTERN)?.length ?? 0;
}

function declaresContract(source: string): boolean {
    return /\bcontract\s+[A-Za-z_]/.test(stripComments(source));
}

/**
 * Turns `classifySolidityPath`'s prose into the report's vocabulary.
 *
 * The classifier explains itself in words because it also feeds an import
 * summary, where "dependency or build output (node_modules)" is the useful
 * string. The report needs the category, so the mapping happens here rather than
 * by widening the shared function's return type for one consumer.
 */
function skipReasonFor(reason: string): SkipReason {
    return reason.startsWith('test or script') ? 'test-file' : 'dependency';
}

function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function planContracts(
    files: Record<string, string>,
    cap: number,
    chosen: ReadonlySet<string> | null = null,
): Plan {
    const auditable: PlannedContract[] = [];
    const skipped: SkippedContract[] = [];
    const notes: string[] = [];
    let oversized = 0;
    let unselected = 0;

    for (const [path, source] of Object.entries(files)) {
        if (!path.toLowerCase().endsWith('.sol')) continue;

        const classification = classifySolidityPath(path);
        if (!classification.audit) {
            skipped.push({ path, reason: skipReasonFor(classification.reason ?? '') });
            continue;
        }
        if (isInterfaceOnly(source)) {
            skipped.push({ path, reason: 'interface-only' });
            continue;
        }
        if (!declaresContract(source)) {
            skipped.push({ path, reason: 'no-contract' });
            continue;
        }

        const bytes = Buffer.byteLength(source, 'utf8');
        // One generated artifact must not be able to spend the whole report's
        // budget on its own, and a file this size will not finish a compile and
        // a local EVM run inside the per-contract budget anyway.
        if (bytes > MAX_FILE_BYTES) {
            skipped.push({ path, reason: 'over-cap' });
            oversized += 1;
            continue;
        }

        // A selection is applied before the cap, so a chosen contract is never
        // dropped for being smaller than ten that nobody asked about.
        if (chosen !== null && !chosen.has(path)) {
            unselected += 1;
            continue;
        }

        auditable.push({
            id: path,
            path,
            source,
            entrypoints: countEntrypoints(source),
            bytes,
        });
    }

    if (oversized > 0) {
        notes.push(
            `${plural(oversized, 'file')} above ${Math.round(MAX_FILE_BYTES / 1024)} KB ${oversized === 1 ? 'was' : 'were'} not audited, because a source that large cannot be compiled and traced inside the per-contract time budget.`,
        );
    }

    if (unselected > 0) {
        notes.push(
            `${plural(unselected, 'other contract')} in this workspace ${unselected === 1 ? 'was' : 'were'} not audited, because this run was limited to what you selected.`,
        );
    }

    let planned = auditable;
    if (auditable.length > cap) {
        // Largest first, where largest means most surface area rather than most
        // text: a contract with twenty entrypoints is twenty ways in, and that
        // is what an audit is for. Byte length only breaks ties.
        const ranked = [...auditable].sort(
            (a, b) => b.entrypoints - a.entrypoints || b.bytes - a.bytes,
        );
        const kept = new Set(ranked.slice(0, cap).map((contract) => contract.id));

        for (const contract of auditable) {
            if (!kept.has(contract.id)) skipped.push({ path: contract.path, reason: 'over-cap' });
        }
        // Original file order, so the report reads like the repository does.
        planned = auditable.filter((contract) => kept.has(contract.id));

        notes.push(
            `${plural(auditable.length - cap, 'contract')} of ${auditable.length} ${auditable.length - cap === 1 ? 'was' : 'were'} not audited. One run audits at most ${cap}, because a full audit takes about twenty seconds a contract and the request has a hard time limit. The ones kept are the largest by number of public and external functions.`,
        );
    }

    return { planned, skipped, notes };
}

// ============= RUNNING A SECTION =============

/** Marks the budget promise, so a real result of any shape stays distinguishable. */
interface Finished<T> {
    finished: true;
    value: T;
}

/**
 * Runs one section under its own time budget.
 *
 * Nothing a section does may take down the report, so both ways of going wrong
 * end as data: a throw becomes the error's own message, and overrunning becomes
 * a timeout that says so. The distinction matters to the reader, because "this
 * contract does not compile" and "this contract is too big to measure in 25
 * seconds" are different problems with different next steps.
 *
 * The honest caveat: solc and the parallel parser are synchronous, so a section
 * that blocks the event loop finishes before the timer is ever read. The budget
 * bounds the sections that await, which are the ones that talk to the network
 * and the ones that can actually hang.
 */
async function runSection<T>(run: () => Promise<T> | T): Promise<Section<T>> {
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const budget = new Promise<{ finished: false }>((resolve) => {
        timer = setTimeout(() => resolve({ finished: false }), CONTRACT_BUDGET_MS);
    });

    const work: Promise<Finished<T>> = Promise.resolve()
        .then(run)
        .then((value) => ({ finished: true as const, value }));
    // An abandoned section still settles. Without this it would reject with
    // nobody listening, which ends the Node process rather than the section.
    work.catch(() => undefined);

    try {
        const outcome = await Promise.race<Finished<T> | { finished: false }>([work, budget]);
        if (!outcome.finished) {
            return {
                status: 'failed',
                failure: { reason: 'Exceeded the 25s measurement budget', timedOut: true },
            };
        }
        return { status: 'ok', data: outcome.value, durationMs: Date.now() - startedAt };
    } catch (error) {
        return {
            status: 'failed',
            failure: {
                reason:
                    error instanceof Error ? error.message : 'The measurement failed without a message',
                timedOut: false,
            },
        };
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

// ============= HEALTH =============

function headlineFor(counts: SeverityCounts): string {
    if (counts.critical > 0) {
        return `${plural(counts.critical, 'critical issue')} to fix before this goes anywhere near mainnet.`;
    }
    if (counts.high > 0) {
        return `${plural(counts.high, 'high severity issue')} worth fixing before you deploy.`;
    }
    if (counts.medium > 0) {
        return `Nothing critical, and ${plural(counts.medium, 'medium severity issue')} worth a look.`;
    }
    if (counts.low + counts.info > 0) {
        return `Clean on the checks that ran, with ${plural(counts.low + counts.info, 'minor note')}.`;
    }
    return 'Nothing was flagged by the checks that ran.';
}

/**
 * The per-contract score.
 *
 * Findings set the baseline, because an exploitable contract is not improved by
 * being cheap or parallel. Parallel fitness is then blended in at three tenths,
 * which is enough weight to move a grade and not enough to rescue a contract
 * with a critical finding in it. When the parallel section did not run there is
 * nothing to blend and the baseline stands on its own, rather than being
 * penalised for a measurement we failed to take.
 */
function healthFor(findings: readonly Finding[], parallel: Section<ParallelAnalysisResult>): Health {
    const penalty = findings.reduce((total, finding) => total + SEVERITY_WEIGHT[finding.severity], 0);
    const derived = Math.max(0, Math.min(100, 100 - penalty));

    const score = isOk(parallel)
        ? Math.round(0.7 * derived + 0.3 * parallel.data.score)
        : derived;

    return { score, grade: gradeFor(score), headline: headlineFor(countBySeverity(findings)) };
}

function addCounts(into: SeverityCounts, from: SeverityCounts): SeverityCounts {
    return {
        critical: into.critical + from.critical,
        high: into.high + from.high,
        medium: into.medium + from.medium,
        low: into.low + from.low,
        info: into.info + from.info,
    };
}

/**
 * The name solc would put on the artifact.
 *
 * Taken from whichever engine got far enough to compile, because the filename is
 * a convention and the contract name is a fact. The regex fallback is for the
 * case where nothing compiled, and the basename is for the case where even that
 * failed, which should be impossible given the plan rejected sources with no
 * contract in them.
 */
function resolveName(path: string, source: string, sections: ContractSections): string {
    if (isOk(sections.gas)) return sections.gas.data.contractName;
    if (isOk(sections.chainfit)) return sections.chainfit.data.contractName;
    if (isOk(sections.parallel) && sections.parallel.data.contract.length > 0) {
        return sections.parallel.data.contract;
    }

    const declared = /\bcontract\s+([A-Za-z_]\w*)/.exec(stripComments(source));
    if (declared !== null) return declared[1];

    return path.split('/').pop()?.replace(/\.sol$/i, '') ?? path;
}

// ============= THE BUILD =============

function selectChains(chains: string[] | undefined): ChainId[] | undefined {
    if (chains === undefined) return undefined;
    const known = chains.filter(isChainId);
    // An empty selection means the comparison's default set, not no chains.
    return known.length > 0 ? known : undefined;
}

/**
 * The repository's score, which is its worst contract's.
 *
 * Extracted so the running snapshot and the finished report cannot disagree.
 * Two copies of a rollup is how a partial report ends up claiming a grade the
 * final one contradicts.
 */
function healthAcross(contracts: readonly ContractReport[]): Health | null {
    const scores = contracts
        .map((contract) => contract.health)
        .filter((entry): entry is Health => entry !== null)
        .map((entry) => entry.score);

    if (scores.length === 0) return null;

    const worst = Math.min(...scores);
    return {
        score: worst,
        grade: gradeFor(worst),
        headline:
            contracts.length === 1
                ? `This contract scores ${worst} out of 100.`
                : `The weakest of ${plural(contracts.length, 'audited contract')} scores ${worst} out of 100.`,
    };
}

export async function* buildRepoReport(input: BuildInput): AsyncGenerator<ReportEvent> {
    const reportId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    // The tier says what someone is entitled to; the wall clock says what one
    // request can deliver. Taking the smaller of the two is what stops a Pro
    // report from dying at the ceiling with most of the repository unmeasured.
    const effectiveCap = Math.min(input.cap, CONTRACTS_PER_RUN);
    // A selection filters the plan rather than the file map, so the compiler
    // still sees every source and imports keep resolving.
    const chosen = input.only === undefined ? null : new Set(input.only);
    const { planned, skipped, notes } = planContracts(input.files, effectiveCap, chosen);
    const chains = selectChains(input.chains);

    yield {
        type: 'started',
        reportId,
        planned: planned.map((contract) => ({ id: contract.id, path: contract.path })),
        skipped,
    };

    const contracts: ContractReport[] = [];
    let counts = emptyCounts();
    let anySectionFailed = false;
    const auditNotes = new Set<string>();
    const descriptions = new Map<string, string>();
    const verifications = new Map<string, NonNullable<ContractReport['verification']>>();
    const threatAuthors = new Map<string, string>();
    const invariantSets = new Map<string, string[]>();
    const threatModels = new Map<
        string,
        Array<{ title: string; target: string; approach: string }>
    >();

    // The deep audit shares the run's wall clock with everything else, so its
    // budget shrinks as the number of contracts grows. A ten contract repo must
    // not spend ninety seconds each on the audit and time out before the tenth.
    const reusable = (path: string, source: string): ContractReport | null => {
        const earlier = input.reuse?.[path];
        if (earlier === undefined || earlier.sourceHash !== keccak256(toBytes(source))) return null;
        return earlier;
    };
    const toAudit = planned.filter((contract) => reusable(contract.path, contract.source) === null).length;
    const auditBudgetMs = Math.max(20_000, Math.round(240_000 / Math.max(1, toAudit)));

    for (const [index, contract] of planned.entries()) {
        const { id, path, source } = contract;

        const earlier = reusable(path, source);
        if (earlier !== null) {
            const reused: ContractReport = { ...earlier, id };
            contracts.push(reused);
            counts = addCounts(counts, reused.counts);
            yield { type: 'progress', done: index + 1, total: planned.length, label: `Unchanged since the last review: ${path}` };
            yield { type: 'contract', contract: reused };
            continue;
        }

        const sections: ContractSections = {
            security: pending(),
            parallel: pending(),
            gas: pending(),
            chainfit: pending(),
        };
        const findings: Finding[] = [];

        // Cheapest first. A reader watching the rail fill gets the security
        // verdict in milliseconds and the expensive chain comparison last, which
        // is also the order they care about them in.
        sections.security = await runSection(() => analyzeSecurity(source));
        if (isOk(sections.security)) {
            findings.push(...withIds(id, 'security', securityFindings(path, sections.security.data)));
        }
        yield { type: 'section', contractId: id, section: 'security', result: sections.security };

        /*
          The deep audit starts here and runs alongside the measurements below.

          The static rules are a floor: fast, deterministic, and incapable of
          inventing a finding. They are also the same fourteen questions for
          every contract, which is exactly the failure mode Monad wrote about.
          The deep audit builds a threat model from what this contract is for,
          then tests it against the code and has a second model try to knock the
          results down.

          It needs only the static findings, so it does not wait for parallel,
          gas and chain fit, which need no model at all; running them side by
          side takes the slowest step off the critical path. Its findings are
          still added after theirs, so the report reads the same as before.
          When it cannot run, the note says so rather than letting a shallow
          pass look like a deep one.
        */
        const auditOptions = {
            budgetMs: auditBudgetMs,
            // What the parser already proved, so the reviewer cannot talk
            // itself out of a vulnerability the static pass confirmed.
            confirmed: findings
                .filter((finding) => finding.source === 'security')
                .map((finding) => ({
                    title: finding.title,
                    ...(finding.line !== undefined ? { line: finding.line } : {}),
                })),
        };
        const review = input.fixReview?.path === path ? input.fixReview : input.fixReviews?.[path];
        const auditRun: Promise<DeepAudit | Error> = (
            review !== undefined
                ? fixReview(source, review, auditOptions)
                : deepAudit(source, auditOptions)
        ).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));

        sections.parallel = await runSection(() => analyzeParallelPotential(source));
        if (isOk(sections.parallel)) {
            findings.push(...withIds(id, 'parallel', parallelFindings(path, sections.parallel.data)));
        }
        yield { type: 'section', contractId: id, section: 'parallel', result: sections.parallel };

        // Gas and chain fit compile the contract, and a contract that imports
        // its siblings only compiles with them, so those two get the contract
        // flattened together with everything it imports.
        const unit = flattenImportClosure(path, input.files) ?? source;

        sections.gas = await runSection(async () => {
            // deployedBytecode is requested for the EIP-170 size figure; bytecode
            // is what makes solc emit creation estimates at all.
            const compiled = await compileVersioned(unit, {
                outputs: ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'evm.gasEstimates'],
            });
            return buildGasProfile(unit, compiled);
        });
        if (isOk(sections.gas)) {
            findings.push(...withIds(id, 'gas', gasFindings(path, sections.gas.data)));
        }
        yield { type: 'section', contractId: id, section: 'gas', result: sections.gas };

        sections.chainfit = await runSection(() =>
            buildChainFitReport({ source: unit, ...(chains === undefined ? {} : { chains }) }),
        );
        if (isOk(sections.chainfit)) {
            findings.push(...withIds(id, 'chainfit', chainFitFindings(path, sections.chainfit.data)));
        }
        yield { type: 'section', contractId: id, section: 'chainfit', result: sections.chainfit };

        const audit = await auditRun;
        if (audit instanceof Error) {
            auditNotes.add(
                'The threat-model audit did not complete, so these findings are from the static pass only.',
            );
            console.warn('[report] deep audit failed:', audit.message);
        } else {
            findings.push(...toFindings(audit, id));
            for (const note of audit.notes) auditNotes.add(note);
            if (audit.description !== null) descriptions.set(id, audit.description.purpose);
            if (audit.description !== null && audit.description.invariants.length > 0) {
                invariantSets.set(id, audit.description.invariants);
            }
            if (audit.verification !== undefined) verifications.set(id, audit.verification);
            if (audit.threatModelBy !== undefined) threatAuthors.set(id, audit.threatModelBy);
            if (audit.threats.length > 0) {
                threatModels.set(
                    id,
                    audit.threats.map((threat) => ({
                        title: threat.title,
                        target: threat.target,
                        approach: threat.approach,
                    })),
                );
            }
        }

        anySectionFailed =
            anySectionFailed ||
            Object.values(sections).some((section) => section.status === 'failed');

        const contractCounts = countBySeverity(findings);
        const purpose = descriptions.get(id);
        const report: ContractReport = {
            id,
            path,
            sourceHash: keccak256(toBytes(source)),
            name: resolveName(path, source, sections),
            ...(purpose !== undefined ? { purpose } : {}),
            ...(threatModels.has(id) ? { threats: threatModels.get(id) } : {}),
            ...(invariantSets.has(id) ? { invariants: invariantSets.get(id) } : {}),
            ...(verifications.has(id) ? { verification: verifications.get(id) } : {}),
            ...(threatAuthors.has(id) ? { threatModelBy: threatAuthors.get(id) } : {}),
            health: healthFor(findings, sections.parallel),
            findings,
            counts: contractCounts,
            sections,
        };

        contracts.push(report);
        counts = addCounts(counts, contractCounts);

        yield {
            type: 'progress',
            done: index + 1,
            total: planned.length,
            label: `Measured ${path}`,
            // Everything finished so far, so a run that is cut off still leaves
            // a readable report behind at the id the client was already given.
            snapshot: {
                reportId,
                createdAt,
                origin: input.origin,
                health: healthAcross(contracts),
                counts,
                contracts: [...contracts],
                skipped,
                notes: [
                    ...notes,
                    'This report was still running when it was saved, so some contracts may be missing.',
                ],
                redacted: false,
            },
        };
        yield { type: 'contract', contract: report };
    }

    const health = healthAcross(contracts);
    if (health !== null && contracts.length > 1) {
        notes.push(
            'A repository is only as safe as its worst contract, so the score above is the lowest of the contracts audited rather than their average.',
        );
    }

    for (const note of auditNotes) notes.push(note);

    if (anySectionFailed) {
        notes.push(
            'Some measurements did not complete. Each contract shows which section failed and why, rather than hiding it.',
        );
    }
    if (planned.length === 0) {
        notes.push(
            'No auditable contracts were found. Tests, scripts, dependencies and interface-only files are listed as skipped above.',
        );
    }

    const report: RepoReport = {
        reportId,
        createdAt,
        origin: input.origin,
        health,
        counts,
        contracts,
        skipped,
        notes,
        redacted: false,
    };

    yield { type: 'complete', report };
}

/**
 * A stored report with its static security pass run again on the given source.
 *
 * The static rules are deterministic, so when one is corrected a stored report
 * can be brought up to date without repeating the model calls that produced the
 * rest of it. Only the security section and its findings change; counts and
 * health are recomputed from the result.
 */
export function rescoreStatic(report: RepoReport, sources: Readonly<Record<string, string>>): RepoReport {
    const contracts = report.contracts.map((contract) => {
        const source = sources[contract.path];
        if (source === undefined) return contract;
        const analysis = analyzeSecurity(source);
        const findings = [
            ...withIds(contract.id, 'security', securityFindings(contract.path, analysis)),
            ...contract.findings.filter((finding) => finding.source !== 'security'),
        ];
        return {
            ...contract,
            findings,
            counts: countBySeverity(findings),
            health: healthFor(findings, contract.sections.parallel),
            sections: {
                ...contract.sections,
                security: { status: 'ok' as const, data: analysis, durationMs: 0 },
            },
        };
    });
    const counts = contracts.reduce((total, contract) => addCounts(total, contract.counts), emptyCounts());
    return { ...report, contracts, counts, health: healthAcross(contracts) };
}

/** Exposed for tests only: the static rules are pure and their false positives are the point. */
export const __testing = { analyzeSecurity };
