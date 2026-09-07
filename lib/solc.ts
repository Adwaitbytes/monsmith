import * as fs from "fs";
import * as path from "path";
import solc from "solc";
import { getAddress } from "viem";
import type { Abi } from "viem";
import { OPENZEPPELIN_SOURCES } from "./openzeppelin-bundle";

/**
 * Shared solc-js front end.
 *
 * Compilation lives here rather than in a route so that every caller resolves
 * OpenZeppelin imports the same way. Divergent import handling between routes
 * was previously a source of "compiles in the editor, fails on deploy" bugs.
 */

// Virtual filename handed to solc. Deliberately not a real path: compilation is
// done entirely in memory so a user's contract can never overwrite a tracked
// source file (contracts/GenContract.sol is a fixture the test suite depends on).
export const VIRTUAL_SOURCE = 'Contract.sol';

/** What solc reports back per source unit. Only the fields we consume are typed. */
export interface SolcGasEstimates {
    creation?: {
        codeDepositCost?: string;
        executionCost?: string;
        totalCost?: string;
    };
    external?: Record<string, string>;
    internal?: Record<string, string>;
}

export interface CompiledContract {
    abi: Abi;
    evm?: {
        bytecode?: {
            object?: string;
            /**
             * Where the compiler left 20-byte holes for library addresses it
             * cannot know until they are deployed. Bytecode carrying one of
             * these is not deployable as-is.
             */
            linkReferences?: Record<string, Record<string, { start: number; length: number }[]>>;
        };
        deployedBytecode?: {
            object?: string;
            /**
             * Byte ranges the compiler left blank for `immutable` values, which
             * are written in at construction. Needed to compare compiler output
             * against deployed code without tripping over them.
             */
            immutableReferences?: Record<string, { start: number; length: number }[]>;
        };
        gasEstimates?: SolcGasEstimates;
    };
}

interface SolcError {
    severity: 'error' | 'warning' | 'info';
    formattedMessage: string;
}

/** A successful compile of the user's source unit. */
export interface CompileOutput {
    /** Name solc used for the selected contract, not the name guessed from the source. */
    contractName: string;
    contract: CompiledContract;
    warnings: string[];
}

export interface CompileResult {
    abi: Abi;
    bytecode: string;
}

/**
 * solc rejects addresses whose EIP-55 checksum is wrong, and models emit
 * lowercase or mixed-case literals constantly. Re-checksumming is mechanical,
 * so it is done here instead of failing the compile.
 */
export function fixAddressChecksums(sourceCode: string): string {
    const addressRegex = /0x[a-fA-F0-9]{40}/g;
    return sourceCode.replace(addressRegex, (match) => {
        try {
            return getAddress(match);
        } catch {
            return match;
        }
    });
}

/** Resolves imports from the bundled OpenZeppelin, falling back to node_modules locally. */
function findImports(importPath: string): { contents: string } | { error: string } {
    if (OPENZEPPELIN_SOURCES[importPath]) {
        return { contents: OPENZEPPELIN_SOURCES[importPath] };
    }

    // Serverless bundles do not ship node_modules, so this path only ever helps
    // during local development against a newer OpenZeppelin than the bundle.
    if (importPath.startsWith('@openzeppelin/')) {
        try {
            const ozPath = path.join(process.cwd(), 'node_modules', importPath);
            if (fs.existsSync(ozPath)) {
                return { contents: fs.readFileSync(ozPath, 'utf8') };
            }
        } catch {
            // Fall through to the not-found error below.
        }
    }

    return { error: `File not found: ${importPath}` };
}

/**
 * Compiles one Solidity source in memory and returns the contract it defines.
 *
 * `outputs` is the solc outputSelection list. Callers ask only for what they
 * need: requesting gas estimates makes solc run its cost analysis, which is
 * wasted work on the deploy path.
 */
export function compileContract(
    sourceCode: string,
    outputs: string[] = ['abi', 'evm.bytecode']
): CompileOutput {
    const source = fixAddressChecksums(sourceCode);

    const contractNameMatch = source.match(/contract\s+(\w+)/);
    const declaredName = contractNameMatch ? contractNameMatch[1] : "GenContract";

    const input = {
        language: 'Solidity',
        sources: {
            [VIRTUAL_SOURCE]: { content: source }
        },
        settings: {
            outputSelection: {
                '*': { '*': outputs }
            },
            optimizer: {
                enabled: true,
                runs: 200
            }
        }
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

    const diagnostics: SolcError[] = output.errors ?? [];
    const errors = diagnostics.filter((e) => e.severity === 'error');
    if (errors.length > 0) {
        throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
    }

    const contracts: Record<string, CompiledContract> | undefined = output.contracts?.[VIRTUAL_SOURCE];
    if (!contracts || Object.keys(contracts).length === 0) {
        throw new Error('No contracts found in compilation output');
    }

    // The regex finds the first `contract` keyword, which is usually but not
    // always the deployable one (a file may lead with a helper or interface).
    const contractName = contracts[declaredName] ? declaredName : Object.keys(contracts)[0];

    return {
        contractName,
        contract: contracts[contractName],
        warnings: diagnostics.filter((e) => e.severity === 'warning').map((e) => e.formattedMessage),
    };
}

/**
 * Compiles a contract for deployment. Throws unless real bytecode came out,
 * because an interface or abstract contract cannot be deployed and the caller
 * would otherwise send an empty transaction.
 */
export async function compileSolidity(sourceCode: string): Promise<CompileResult> {
    try {
        const { contractName, contract, warnings } = compileContract(sourceCode);

        console.log(`📦 Compiled contract: ${contractName}`);
        if (warnings.length > 0) {
            console.log(`⚠️ ${warnings.length} compilation warnings`);
        }

        const bytecode = contract?.evm?.bytecode?.object;
        if (!bytecode) {
            throw new Error(
                `Contract compilation produced no bytecode. Abstract contracts and interfaces cannot be deployed.`
            );
        }

        console.log(`✅ Compilation successful! Bytecode size: ${bytecode.length / 2} bytes`);

        return { abi: contract.abi, bytecode };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('❌ Compilation error:', message);
        throw new Error(`Compilation failed: ${message}`);
    }
}
