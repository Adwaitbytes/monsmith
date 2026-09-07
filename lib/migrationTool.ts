/**
 * Contract Migration Tool for Monad
 *
 * Enables developers to import existing Ethereum contracts,
 * analyze them for Monad compatibility, and optimize them for
 * Monad's parallel EVM execution.
 */

import { analyzeParallelPotential } from './parallelAnalyzer';
import { checkCompiles } from './solcCheck';
import type { FetchedContract, NetworkType } from './contractSources';

// Source resolution lives in ./contractSources; re-exported here so the
// migration surface stays a single import for callers.
export {
  fetchContractSource,
  ContractSourceError,
  NETWORKS,
  isNetworkType,
} from './contractSources';
export type {
  FetchedContract,
  NetworkType,
  ContractSourceFailure,
} from './contractSources';

// ============= TYPE DEFINITIONS =============

export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface CompatibilityIssue {
  severity: IssueSeverity;
  type: string;
  title: string;
  description: string;
  line?: number;
  column?: number;
  code?: string;
  fix?: {
    description: string;
    replacement?: string;
    autoFixable: boolean;
  };
}

export interface CodeChange {
  type: 'pragma' | 'import' | 'security' | 'pattern' | 'optimization' | 'license';
  line: number;
  original: string;
  replacement: string;
  reason: string;
  autoFixed: boolean;
}

export interface TransformResult {
  originalCode: string;
  migratedCode: string;
  changes: CodeChange[];
  autoFixedCount: number;
  manualFixCount: number;
  /** Whether the migrated source actually compiles under Solidity 0.8. */
  compiles?: boolean;
  /** Remaining compiler errors when it does not. */
  compileErrors?: string[];
}

export interface MigrationResult {
  contract: {
    name: string;
    address?: string;
    network?: NetworkType;
    sourceCode: string;
    compiler: string;
    isVerified: boolean;
    /** Present for address imports: which explorer answered, and how many files it returned. */
    sourceProvider?: string;
    fileCount?: number;
    isProxy?: boolean;
    implementationAddress?: string;
  };
  analysis: {
    compatibilityScore: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    issues: CompatibilityIssue[];
    parallelScore: number;
    parallelGrade: string;
  };
  migration: TransformResult;
  metadata: {
    analysisTimeMs: number;
    timestamp: string;
  };
}

// ============= COMPATIBILITY PATTERNS =============

interface CompatibilityPattern {
  pattern: RegExp;
  severity: IssueSeverity;
  type: string;
  title: string;
  description: string;
  fix?: {
    description: string;
    replacement?: string | ((match: string) => string);
    autoFixable: boolean;
  };
}

const COMPATIBILITY_PATTERNS: CompatibilityPattern[] = [
  // CRITICAL - May not work on Monad
  {
    pattern: /selfdestruct\s*\(/g,
    severity: 'critical',
    type: 'deprecated_opcode',
    title: 'SELFDESTRUCT Usage Detected',
    description: 'selfdestruct is deprecated in EIP-6049 and may not work as expected on Monad. The contract balance transfer behavior is changing.',
    fix: {
      description: 'Remove selfdestruct and implement a withdrawal pattern instead. Consider using a pausable + withdrawal mechanism.',
      autoFixable: false,
    },
  },
  {
    pattern: /suicide\s*\(/g,
    severity: 'critical',
    type: 'deprecated_opcode',
    title: 'SUICIDE Opcode (Deprecated)',
    description: 'suicide() is the old name for selfdestruct() and is deprecated.',
    fix: {
      description: 'Remove this pattern and implement proper withdrawal mechanics.',
      autoFixable: false,
    },
  },

  // HIGH - Security concerns
  {
    pattern: /tx\.origin/g,
    severity: 'high',
    type: 'security',
    title: 'tx.origin Usage for Authorization',
    description: 'Using tx.origin for authorization is vulnerable to phishing attacks. An attacker can trick a user into calling their malicious contract which then calls your contract.',
    fix: {
      description: 'Replace tx.origin with msg.sender for authorization checks',
      replacement: 'msg.sender',
      autoFixable: true,
    },
  },
  {
    pattern: /\.call\{[^}]*\}\s*\([^)]*\)\s*;/g,
    severity: 'high',
    type: 'security',
    title: 'Unchecked External Call',
    description: 'External call return value is not checked. This can lead to silent failures.',
    fix: {
      description: 'Always check the return value of external calls: (bool success, ) = target.call{...}(...); require(success);',
      autoFixable: false,
    },
  },

  // MEDIUM - Behavioral differences
  {
    pattern: /block\.difficulty/g,
    severity: 'medium',
    type: 'randomness',
    title: 'block.difficulty Usage',
    description: 'block.difficulty was replaced by block.prevrandao after The Merge. Monad may have different randomness characteristics.',
    fix: {
      description: 'Use block.prevrandao for post-Merge compatibility, or Chainlink VRF for secure randomness.',
      replacement: 'block.prevrandao',
      autoFixable: true,
    },
  },
  {
    pattern: /block\.prevrandao/g,
    severity: 'medium',
    type: 'randomness',
    title: 'block.prevrandao Usage',
    description: 'block.prevrandao is pseudo-random and can be influenced by validators. For Monad, consider the consensus mechanism differences.',
    fix: {
      description: 'For production randomness, consider using Chainlink VRF or similar oracle solutions.',
      autoFixable: false,
    },
  },
  {
    pattern: /block\.timestamp\s*[<>=]/g,
    severity: 'medium',
    type: 'timing',
    title: 'Timestamp Dependency',
    description: 'Contract logic depends on block.timestamp. Monad has ~400ms block times vs Ethereum\'s 12s, which may affect time-sensitive logic.',
    fix: {
      description: 'Review time-sensitive logic for faster block times. Adjust any time windows accordingly.',
      autoFixable: false,
    },
  },

  // LOW - Best practices
  {
    // Any comparator, not just the caret. A pinned `=0.7.6`, which is what
    // Uniswap V3 and most of its era use, was matching nothing at all.
    pattern: /pragma\s+solidity\s+[^;]*0\.[0-7]\.\d+[^;]*/g,
    severity: 'info',
    type: 'compiler_version',
    title: 'Built before Solidity 0.8',
    description:
      'Monad runs this as it is; the EVM does not care which compiler produced the bytecode. Worth knowing rather than fixing: before 0.8 the compiler had no built-in overflow checks, so the contract relies on SafeMath or on the arithmetic being provably safe.',
    fix: {
      description:
        'Upgrading to 0.8 is a choice, not a migration step, and it is not mechanical: the same code often needs explicit conversions and its SafeMath calls removed.',
      autoFixable: false,
    },
  },
  {
    pattern: /pragma\s+solidity\s+[^;]*0\.8\.([0-9]|1[0-9]|2[0-3])\s*;/g,
    severity: 'info',
    type: 'compiler_version',
    title: 'Older 0.8.x Version',
    description: 'A later 0.8 release carries optimiser and codegen improvements. Nothing about Monad requires it.',
    fix: {
      description: 'Raise the pragma if you want the newer codegen; the contract compiles either way.',
      autoFixable: false,
    },
  },

  // INFO - Informational
  {
    pattern: /assembly\s*\{/g,
    severity: 'info',
    type: 'inline_assembly',
    title: 'Inline Assembly Detected',
    description: 'Contract uses inline assembly. Verify assembly opcodes are compatible with Monad\'s EVM implementation.',
    fix: {
      description: 'Review assembly code for opcode compatibility. Most standard opcodes work identically.',
      autoFixable: false,
    },
  },
  {
    pattern: /delegatecall/g,
    severity: 'info',
    type: 'delegatecall',
    title: 'Delegatecall Usage',
    description: 'Contract uses delegatecall. Ensure the target contract is also compatible with Monad.',
    fix: {
      description: 'Verify all contracts in the delegatecall chain are Monad-compatible.',
      autoFixable: false,
    },
  },
];

// ============= MAIN FUNCTIONS =============

/**
 * Check contract for Monad compatibility issues
 */
export function checkMonadCompatibility(sourceCode: string): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];
  const lines = sourceCode.split('\n');

  for (const pattern of COMPATIBILITY_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);

    while ((match = regex.exec(sourceCode)) !== null) {
      // Calculate line number
      const beforeMatch = sourceCode.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      // Get the matched code context
      const lineContent = lines[lineNumber - 1]?.trim() || match[0];

      issues.push({
        severity: pattern.severity,
        type: pattern.type,
        title: pattern.title,
        description: pattern.description,
        line: lineNumber,
        code: lineContent,
        fix: pattern.fix ? {
          description: pattern.fix.description,
          replacement: typeof pattern.fix.replacement === 'function'
            ? pattern.fix.replacement(match[0])
            : pattern.fix.replacement,
          autoFixable: pattern.fix.autoFixable,
        } : undefined,
      });
    }
  }

  // Check for missing SPDX license
  if (!sourceCode.includes('SPDX-License-Identifier')) {
    issues.push({
      severity: 'info',
      type: 'license',
      title: 'Missing SPDX License Identifier',
      description: 'Add an SPDX license identifier for better compatibility and to avoid compiler warnings.',
      line: 1,
      fix: {
        description: 'Add SPDX license identifier at the top of the file',
        replacement: '// SPDX-License-Identifier: MIT',
        autoFixable: true,
      },
    });
  }

  // Sort by severity (critical first)
  const severityOrder: Record<IssueSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };

  return issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

/**
 * Transform code for Monad compatibility with auto-fixes
 */
export function transformForMonad(
  sourceCode: string,
  autoFix: boolean = true
): TransformResult {
  let migratedCode = sourceCode;
  const changes: CodeChange[] = [];
  let autoFixedCount = 0;
  let manualFixCount = 0;

  // Auto-fix: Add SPDX license if missing
  if (autoFix && !sourceCode.includes('SPDX-License-Identifier')) {
    migratedCode = '// SPDX-License-Identifier: MIT\n' + migratedCode;
    changes.push({
      type: 'license',
      line: 1,
      original: '',
      replacement: '// SPDX-License-Identifier: MIT',
      reason: 'Added SPDX license identifier',
      autoFixed: true,
    });
    autoFixedCount++;
  }

  // Auto-fix: legacy syntax must be migrated alongside the pragma, or the
  // rewritten pragma simply moves the failure to the first removed keyword.
  if (autoFix) {
    const legacy = migrateLegacySyntax(migratedCode);
    if (legacy.changes.length > 0) {
      migratedCode = legacy.code;
      for (const change of legacy.changes) {
        changes.push({
          type: 'pattern',
          line: 0,
          original: change.label.split(' -> ')[0],
          replacement: change.label.split(' -> ')[1] ?? '',
          reason: `${change.reason} (${change.count} occurrence${change.count === 1 ? '' : 's'})`,
          autoFixed: true,
        });
        autoFixedCount++;
      }
    }
  }

  // The pragma is deliberately left alone.
  //
  // Monad is EVM compatible and runs bytecode from any compiler, so raising the
  // version is not a migration step. Doing it anyway broke things twice over.
  // On a flattened project the rewrite hit only the first of several pragmas
  // and left `^0.8.24` sitting above `=0.7.6`, which no compiler satisfies. And
  // even done correctly across every pragma it would produce code that does not
  // build, because moving Uniswap V3 from 0.7.6 to 0.8 means explicit
  // conversions and unwinding SafeCast, which no regex does.
  //
  // The same reasoning already governs the legacy syntax rules above: migrating
  // the pragma without migrating the code is worse than doing nothing, because
  // it looks like it worked. The version is reported as a finding instead.

  // Auto-fix: Replace tx.origin with msg.sender
  if (autoFix) {
    const txOriginRegex = /tx\.origin/g;
    let match;
    while ((match = txOriginRegex.exec(sourceCode)) !== null) {
      const lineNum = sourceCode.substring(0, match.index).split('\n').length;
      changes.push({
        type: 'security',
        line: lineNum,
        original: 'tx.origin',
        replacement: 'msg.sender',
        reason: 'Replaced tx.origin with msg.sender for security',
        autoFixed: true,
      });
      autoFixedCount++;
    }
    migratedCode = migratedCode.replace(/tx\.origin/g, 'msg.sender');
  }

  // Auto-fix: Replace block.difficulty with block.prevrandao
  if (autoFix) {
    const difficultyRegex = /block\.difficulty/g;
    let match;
    while ((match = difficultyRegex.exec(sourceCode)) !== null) {
      const lineNum = sourceCode.substring(0, match.index).split('\n').length;
      changes.push({
        type: 'pattern',
        line: lineNum,
        original: 'block.difficulty',
        replacement: 'block.prevrandao',
        reason: 'Updated for post-Merge compatibility',
        autoFixed: true,
      });
      autoFixedCount++;
    }
    migratedCode = migratedCode.replace(/block\.difficulty/g, 'block.prevrandao');
  }

  // Count manual fixes needed
  const issues = checkMonadCompatibility(sourceCode);
  manualFixCount = issues.filter(i => !i.fix?.autoFixable).length;

  return {
    originalCode: sourceCode,
    migratedCode,
    changes,
    autoFixedCount,
    manualFixCount,
  };
}

/**
 * Calculate compatibility score based on issues
 */
function calculateCompatibilityScore(issues: CompatibilityIssue[]): { score: number; grade: 'A' | 'B' | 'C' | 'D' | 'F' } {
  let score = 100;

  for (const issue of issues) {
    switch (issue.severity) {
      case 'critical':
        score -= 25;
        break;
      case 'high':
        score -= 15;
        break;
      case 'medium':
        score -= 8;
        break;
      case 'low':
        score -= 3;
        break;
      case 'info':
        score -= 1;
        break;
    }
  }

  score = Math.max(0, Math.min(100, score));

  let grade: 'A' | 'B' | 'C' | 'D' | 'F';
  if (score >= 90) grade = 'A';
  else if (score >= 75) grade = 'B';
  else if (score >= 60) grade = 'C';
  else if (score >= 40) grade = 'D';
  else grade = 'F';

  return { score, grade };
}

/**
 * Full migration analysis - combines all analysis steps
 */
export async function analyzeForMigration(
  sourceCode: string,
  contractInfo?: Partial<FetchedContract>,
  autoFix: boolean = true
): Promise<MigrationResult> {
  const startTime = Date.now();

  // Check compatibility issues
  const issues = checkMonadCompatibility(sourceCode);

  // Calculate compatibility score
  const { score: compatibilityScore, grade } = calculateCompatibilityScore(issues);

  // Transform code with auto-fixes
  const migration = transformForMonad(sourceCode, autoFix);

  // Verify the rewrite rather than assume it. A contract that still fails to
  // compile after migration is the single most useful thing to report, and
  // claiming a compatibility score for it would be misleading.
  const compileCheck = await checkCompiles(migration.migratedCode);

  // Get parallel execution analysis
  let parallelScore = 0;
  let parallelGrade = 'F';

  try {
    const parallelAnalysis = analyzeParallelPotential(migration.migratedCode);
    parallelScore = parallelAnalysis.score;
    parallelGrade = parallelAnalysis.grade;
  } catch {
    // If parallel analysis fails, default to 50
    parallelScore = 50;
    parallelGrade = 'C';
  }

  const analysisTimeMs = Date.now() - startTime;

  return {
    contract: {
      name: contractInfo?.name || extractContractName(sourceCode),
      address: contractInfo?.address,
      network: contractInfo?.network,
      sourceCode,
      compiler: contractInfo?.compiler || 'Unknown',
      isVerified: contractInfo?.isVerified ?? false,
      sourceProvider: contractInfo?.sourceProvider,
      fileCount: contractInfo?.fileCount,
      isProxy: contractInfo?.isProxy,
      implementationAddress: contractInfo?.implementationAddress,
    },
    analysis: {
      compatibilityScore,
      grade,
      issues,
      parallelScore,
      parallelGrade,
    },
    migration: { ...migration, compiles: compileCheck.compiles, compileErrors: compileCheck.errors },
    metadata: {
      analysisTimeMs,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Extract contract name from source code.
 *
 * Comments are stripped first and the match is anchored to a declaration. A
 * bare /contract\\s+(\\w+)/ happily matches prose such as
 * "@dev Simple staking contract with rewards" and reports the name as "with".
 */
function extractContractName(sourceCode: string): string {
  const withoutComments = sourceCode
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  const match = withoutComments.match(
    /^\s*(?:abstract\s+)?contract\s+(\w+)\s*(?:is\b|\{)/m
  );
  return match ? match[1] : "Unknown";
}

/**
 * Quick compatibility check for real-time feedback
 */
export function quickCompatibilityCheck(sourceCode: string): {
  score: number;
  grade: string;
  criticalIssues: number;
  totalIssues: number;
} {
  const issues = checkMonadCompatibility(sourceCode);
  const { score, grade } = calculateCompatibilityScore(issues);
  const criticalIssues = issues.filter(i => i.severity === 'critical').length;

  return {
    score,
    grade,
    criticalIssues,
    totalIssues: issues.length,
  };
}

/**
 * Syntax that Solidity removed between 0.4 and 0.8.
 *
 * Contracts verified years ago, USDT among them, are written in 0.4 and cannot
 * even be parsed by a 0.8 compiler. Rewriting the pragma alone produces a file
 * that still fails on the first `constant` keyword, so migrating the pragma
 * without migrating the syntax is worse than doing nothing: it looks like the
 * tool succeeded.
 */
interface LegacyRule {
  pattern: RegExp;
  replacement: string;
  reason: string;
  /** Shown when a rule fires; used to explain what changed. */
  label: string;
}

const LEGACY_SYNTAX_RULES: LegacyRule[] = [
  {
    // `function f() public constant returns (uint)` -> `view`
    pattern: /\bconstant\b(?=\s*(?:public|external|internal|private|returns|\{))/g,
    replacement: 'view',
    reason: 'The `constant` function modifier was replaced by `view` in Solidity 0.5',
    label: 'constant -> view',
  },
  {
    pattern: /\bthrow\s*;/g,
    replacement: 'revert();',
    reason: '`throw` was removed in Solidity 0.5; `revert()` is the replacement',
    label: 'throw -> revert()',
  },
  {
    pattern: /\bsha3\s*\(/g,
    replacement: 'keccak256(',
    reason: '`sha3` was renamed to `keccak256`',
    label: 'sha3 -> keccak256',
  },
  {
    pattern: /\bsuicide\s*\(/g,
    replacement: 'selfdestruct(',
    reason: '`suicide` was renamed to `selfdestruct`',
    label: 'suicide -> selfdestruct',
  },
  {
    pattern: /\bmsg\.gas\b/g,
    replacement: 'gasleft()',
    reason: '`msg.gas` was replaced by `gasleft()`',
    label: 'msg.gas -> gasleft()',
  },
  {
    pattern: /\bblock\.blockhash\s*\(/g,
    replacement: 'blockhash(',
    reason: '`block.blockhash` was moved to the global `blockhash`',
    label: 'block.blockhash -> blockhash',
  },
  {
    pattern: /\bthis\.balance\b/g,
    replacement: 'address(this).balance',
    reason: 'Contract members moved behind an explicit address cast in Solidity 0.5',
    label: 'this.balance -> address(this).balance',
  },
  {
    pattern: /\bnow\b(?!\s*[:=])/g,
    replacement: 'block.timestamp',
    reason: '`now` was removed in Solidity 0.7; use `block.timestamp`',
    label: 'now -> block.timestamp',
  },
  {
    pattern: /\bbyte\b(?!\s*s)/g,
    replacement: 'bytes1',
    reason: '`byte` was renamed to `bytes1`',
    label: 'byte -> bytes1',
  },
  {
    pattern: /\buint\s*\(\s*-\s*1\s*\)/g,
    replacement: 'type(uint).max',
    reason: 'Wrapping negative literals was removed; use `type(uint).max`',
    label: 'uint(-1) -> type(uint).max',
  },
  {
    pattern: /\bcallcode\b/g,
    replacement: 'delegatecall',
    reason: '`callcode` was removed in Solidity 0.5',
    label: 'callcode -> delegatecall',
  },
  {
    pattern: /\byears\b(?=\s*[;)*+\-/])/g,
    replacement: 'days * 365',
    reason: 'The `years` time unit was removed in Solidity 0.5',
    label: 'years -> days * 365',
  },
];

/**
 * Marks contracts that declare functions without a body as `abstract`.
 *
 * Solidity 0.6 requires the keyword; before that a contract with an
 * unimplemented function was implicitly abstract. Base contracts in older
 * token code, ERC20Basic and friends, all rely on the old behaviour.
 */
function migrateAbstractContracts(code: string): { code: string; count: number } {
  let count = 0;

  // Each contract body is scanned for a function declaration terminated by a
  // semicolon, which is a declaration without an implementation.
  const migrated = code.replace(
    /(^|\n)(\s*)(contract\s+)(\w+)([^{]*)\{/g,
    (whole, lead: string, indent: string, keyword: string, name: string, inherits: string, offset: number) => {
      const bodyStart = offset + whole.length;
      const body = extractBody(code, bodyStart - 1);
      const hasUnimplemented = /\bfunction\s+\w+\s*\([^)]*\)[^;{]*;/.test(body);
      if (!hasUnimplemented) return whole;
      count++;
      return `${lead}${indent}abstract ${keyword}${name}${inherits}{`;
    }
  );

  return { code: migrated, count };
}

/** Returns the balanced brace body starting at the given opening brace. */
function extractBody(code: string, openBraceIndex: number): string {
  let depth = 0;
  for (let i = openBraceIndex; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return code.slice(openBraceIndex, i + 1);
    }
  }
  return code.slice(openBraceIndex);
}

/**
 * Prefixes event invocations with `emit`, required since Solidity 0.5.
 *
 * Only names that are actually declared as events in the same source are
 * rewritten, so an ordinary function call that happens to be capitalised is
 * left alone.
 */
function migrateEmitKeyword(code: string): { code: string; count: number } {
  const events = [...code.matchAll(/\bevent\s+(\w+)\s*\(/g)].map((m) => m[1]);
  if (events.length === 0) return { code, count: 0 };

  let count = 0;
  let migrated = code;

  for (const name of events) {
    // A statement position: start of a line, not already emitted, not a declaration.
    const bare = new RegExp(`(^|[;{}]\\s*)(\\s*)${name}\\s*\\(`, 'gm');
    migrated = migrated.replace(bare, (whole, prefix: string, indent: string) => {
      if (/\bemit\s*$/.test(prefix + indent)) return whole;
      count++;
      return `${prefix}${indent}emit ${name}(`;
    });
  }

  return { code: migrated, count };
}

/**
 * Removes NatSpec parameter and return tags.
 *
 * solc validates them against the signature and treats a stale tag as a hard
 * error, and contracts of this era routinely document parameters that were
 * later renamed. The prose documentation is preserved.
 */
function stripStaleNatSpec(code: string): { code: string; count: number } {
  const lines = code.split('\n');
  const kept = lines.filter((line) => !/^\s*(\*|\/\/\/)\s*@(param|return)\b/.test(line));
  return { code: kept.join('\n'), count: lines.length - kept.length };
}

/**
 * Adds the data location that Solidity 0.5 made mandatory on reference-type
 * parameters. `constructor(string _name)` no longer compiles; it must say
 * `string memory _name`.
 */
function migrateDataLocations(code: string): { code: string; count: number } {
  let count = 0;

  const migrated = code.replace(
    /\b(function\s+\w+|constructor)\s*\(([^)]*)\)/g,
    (whole, head: string, params: string) => {
      if (!params.trim()) return whole;

      const fixed = params
        .split(',')
        .map((param) => {
          const trimmed = param.trim();
          if (!trimmed) return param;
          if (/\b(memory|calldata|storage)\b/.test(trimmed)) return param;
          // string, bytes and any array type need a location.
          const needsLocation = /^(string|bytes)\b(?!\d)/.test(trimmed) || /\[\s*\]/.test(trimmed);
          if (!needsLocation) return param;
          count++;
          return param.replace(/^(\s*)([\w\[\]]+)/, '$1$2 memory');
        })
        .join(',');

      return `${head}(${fixed})`;
    }
  );

  return { code: migrated, count };
}

/**
 * Casts recipients of native value to `payable`, required since Solidity 0.5.
 *
 * Only single-argument calls are rewritten: `addr.transfer(amount)` moves ether,
 * whereas `token.transfer(to, amount)` is an ERC20 call that must be left alone.
 */
function migratePayableCasts(code: string): { code: string; count: number } {
  let count = 0;
  const migrated = code.replace(
    /\b((?:msg\.sender|[A-Za-z_]\w*(?:\.\w+)?))\.(transfer|send)\(\s*([^,()]*(?:\([^()]*\))?[^,()]*)\)/g,
    (whole, target: string, method: string, arg: string) => {
      if (target.startsWith('payable')) return whole;
      count++;
      return `payable(${target}).${method}(${arg})`;
    }
  );
  return { code: migrated, count };
}

/**
 * Replaces the `var` keyword, removed in Solidity 0.5.
 *
 * The type is inferred from the right-hand side rather than guessed: indexing a
 * mapping yields that mapping's value type, and the declaration is read out of
 * the same source. Where the type cannot be established the statement is left
 * alone so the compiler reports it, which is better than silently choosing a
 * type that changes the contract's behaviour.
 */
function migrateVarDeclarations(code: string): { code: string; count: number } {
  // mapping (address => mapping (address => uint)) public allowed;
  const mappingValueType = (name: string): string | null => {
    const declaration = new RegExp(
      `mapping\\s*\\([^)]*=>\\s*(?:mapping\\s*\\([^)]*=>\\s*([\\w\\[\\]]+)\\s*\\)|([\\w\\[\\]]+))\\s*\\)[^;]*\\b${name}\\b`
    ).exec(code);
    if (!declaration) return null;
    return declaration[1] ?? declaration[2] ?? null;
  };

  let count = 0;
  const migrated = code.replace(
    /\bvar\s+(\w+)\s*=\s*([^;]+);/g,
    (whole, varName: string, expression: string) => {
      const indexed = /^(\w+)\s*\[/.exec(expression.trim());
      if (indexed) {
        const valueType = mappingValueType(indexed[1]);
        if (valueType) {
          count++;
          return `${valueType} ${varName} = ${expression.trim()};`;
        }
      }

      // Arithmetic and numeric literals are uint in this era of contract.
      if (/^[\d\s+\-*/()]+$/.test(expression.trim())) {
        count++;
        return `uint256 ${varName} = ${expression.trim()};`;
      }

      return whole;
    }
  );

  return { code: migrated, count };
}

/**
 * Rewrites the pre-0.6 anonymous fallback function.
 *
 * `function() public payable {}` became `receive() external payable {}` for
 * plain transfers and `fallback() external {}` for unmatched calls. This is one
 * of the first things a 0.4 contract trips on, and WETH9 is the canonical case.
 */
function migrateFallback(code: string): { code: string; changed: boolean; label: string } {
  const payable = /\bfunction\s*\(\s*\)\s*(?:public|external)?\s*payable\s*\{/;
  if (payable.test(code)) {
    return {
      code: code.replace(payable, 'receive() external payable {'),
      changed: true,
      label: 'function() payable -> receive() external payable',
    };
  }

  const plain = /\bfunction\s*\(\s*\)\s*(?:public|external)?\s*\{/;
  if (plain.test(code)) {
    return {
      code: code.replace(plain, 'fallback() external {'),
      changed: true,
      label: 'function() -> fallback() external',
    };
  }

  return { code, changed: false, label: '' };
}

/**
 * Rewrites a contract's constructor from the pre-0.5 form, where the
 * constructor was a function sharing the contract's name.
 */
function migrateNamedConstructor(code: string): { code: string; changed: boolean } {
  // A flattened file holds many contracts, each of which may carry its own
  // legacy constructor, so every declared name has to be considered.
  const names = [...code.matchAll(/\bcontract\s+(\w+)/g)].map((m) => m[1]);
  let migrated = code;
  let changed = false;

  for (const name of names) {
    const legacy = new RegExp(`\\bfunction\\s+${name}\\s*\\(`, 'g');
    if (!legacy.test(migrated)) continue;
    migrated = migrated.replace(legacy, 'constructor(');
    changed = true;
  }

  return { code: migrated, changed };
}

/**
 * Applies every legacy syntax rewrite, reporting each one that fired so the
 * diff view can show the user what was changed on their behalf.
 */
export function migrateLegacySyntax(code: string): {
  code: string;
  changes: { label: string; reason: string; count: number }[];
} {
  let migrated = code;
  const applied: { label: string; reason: string; count: number }[] = [];

  for (const rule of LEGACY_SYNTAX_RULES) {
    const matches = migrated.match(rule.pattern);
    if (!matches || matches.length === 0) continue;
    migrated = migrated.replace(rule.pattern, rule.replacement);
    applied.push({ label: rule.label, reason: rule.reason, count: matches.length });
  }

  const abstracts = migrateAbstractContracts(migrated);
  if (abstracts.count > 0) {
    migrated = abstracts.code;
    applied.push({
      label: 'contract -> abstract contract',
      reason: 'Contracts with unimplemented functions must be declared abstract since Solidity 0.6',
      count: abstracts.count,
    });
  }

  const natspec = stripStaleNatSpec(migrated);
  if (natspec.count > 0) {
    migrated = natspec.code;
    applied.push({
      label: 'stale NatSpec removed',
      reason: 'solc rejects @param and @return tags that do not match the signature',
      count: natspec.count,
    });
  }

  const emits = migrateEmitKeyword(migrated);
  if (emits.count > 0) {
    migrated = emits.code;
    applied.push({
      label: 'event call -> emit',
      reason: 'Event invocations require the `emit` keyword since Solidity 0.5',
      count: emits.count,
    });
  }

  const locations = migrateDataLocations(migrated);
  if (locations.count > 0) {
    migrated = locations.code;
    applied.push({
      label: 'explicit data location',
      reason: 'Reference-type parameters require memory or calldata since Solidity 0.5',
      count: locations.count,
    });
  }

  const payableCasts = migratePayableCasts(migrated);
  if (payableCasts.count > 0) {
    migrated = payableCasts.code;
    applied.push({
      label: 'addr.transfer -> payable(addr).transfer',
      reason: 'Sending native value requires a payable address since Solidity 0.5',
      count: payableCasts.count,
    });
  }

  const vars = migrateVarDeclarations(migrated);
  if (vars.count > 0) {
    migrated = vars.code;
    applied.push({
      label: 'var -> explicit type',
      reason: 'The `var` keyword was removed in Solidity 0.5; the type is inferred from the assignment',
      count: vars.count,
    });
  }

  const fallback = migrateFallback(migrated);
  if (fallback.changed) {
    migrated = fallback.code;
    applied.push({
      label: fallback.label,
      reason: 'The anonymous fallback function was split into receive and fallback in Solidity 0.6',
      count: 1,
    });
  }

  const ctor = migrateNamedConstructor(migrated);
  if (ctor.changed) {
    migrated = ctor.code;
    applied.push({
      label: 'named constructor -> constructor()',
      reason: 'Constructors named after the contract were removed in Solidity 0.5',
      count: 1,
    });
  }

  return { code: migrated, changes: applied };
}
