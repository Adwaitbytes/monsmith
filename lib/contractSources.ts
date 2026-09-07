/**
 * Verified contract source resolution.
 *
 * Sources are tried keyless-first so that importing a contract by address works
 * out of the box with no configuration. Etherscan is last because it is the only
 * provider that needs an API key, and the studio must not depend on one.
 */

import { getAddress } from 'viem';

// ============= PUBLIC TYPES =============

/** Source chain the contract is imported FROM. Deliberately not called
 * 'mainnet': that string means Monad mainnet everywhere else in this codebase. */
export type NetworkType = 'ethereum' | 'sepolia' | 'monad-testnet' | 'monad-mainnet';

export interface FetchedContract {
  name: string;
  address: string;
  network: NetworkType;
  sourceCode: string;
  compiler: string;
  optimizationUsed: boolean;
  runs: number;
  constructorArguments: string;
  isVerified: boolean;
  isProxy: boolean;
  implementationAddress?: string;
  /** Which provider answered, so the UI can tell the user where the code came from. */
  sourceProvider: string;
  /** Number of Solidity files the verified contract is made of. */
  fileCount: number;
}

export type ContractSourceFailure =
  | 'invalid-address'
  | 'unsupported-network'
  | 'not-verified'
  | 'unavailable';

/** Carries a machine-readable reason so callers can map failures onto HTTP codes
 * without matching on message text. */
export class ContractSourceError extends Error {
  readonly failure: ContractSourceFailure;

  constructor(message: string, failure: ContractSourceFailure) {
    super(message);
    this.name = 'ContractSourceError';
    this.failure = failure;
  }
}

// ============= NETWORK CONFIGURATION =============

interface NetworkConfig {
  chainId: number;
  label: string;
  /** Blockscout instance exposing the Etherscan-compatible `/api` surface. */
  blockscoutApi?: string;
}

export const NETWORKS: Record<NetworkType, NetworkConfig> = {
  ethereum: {
    chainId: 1,
    label: 'Ethereum Mainnet',
    blockscoutApi: 'https://eth.blockscout.com/api',
  },
  sepolia: {
    chainId: 11155111,
    label: 'Sepolia Testnet',
    blockscoutApi: 'https://eth-sepolia.blockscout.com/api',
  },
  // Monad's public explorer redirects to a Cloudflare-challenged host that
  // rejects server-side requests, so Sourcify is the only usable provider here.
  'monad-testnet': {
    chainId: 10143,
    label: 'Monad Testnet',
  },
  'monad-mainnet': {
    chainId: 143,
    label: 'Monad Mainnet',
  },
};

export function isNetworkType(value: unknown): value is NetworkType {
  return typeof value === 'string' && value in NETWORKS;
}

// ============= HTTP =============

/** One dead provider must not eat the whole request budget: Vercel Hobby caps a
 * function at 60s and we may consult three providers in sequence. */
const PROVIDER_TIMEOUT_MS = 9_000;

interface JsonResponse {
  status: number;
  body: unknown;
}

async function getJson(url: string): Promise<JsonResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });

    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      // Non-JSON bodies (HTML error pages, bot challenges) surface as a null body
      // and are reported by the caller as an unusable response.
    }

    return { status: response.status, body };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`timed out after ${PROVIDER_TIMEOUT_MS / 1000}s`);
    }
    throw new Error(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

import { flattenSources } from './flatten';

// ============= SOURCE ASSEMBLY =============

/**
 * Flatten a verified contract's file map into a single compilable document.
 *
 * This used to concatenate the files with a header comment each, which left
 * every relative import in place. For a contract like Uniswap V3, spread over
 * 96 files, the result was a document with 20-odd unresolvable imports and
 * several conflicting SPDX identifiers: readable, and rejected by the compiler
 * before it parsed anything. Real flattening strips what only makes sense per
 * file, so the imported contract compiles.
 */
function assembleSources(files: Map<string, string>, primaryPath?: string): string {
  if (files.size === 1) {
    return files.values().next().value ?? '';
  }

  return flattenSources(files, primaryPath).source;
}

/** Solidity compiler versions are quoted both with and without the `v` prefix
 * depending on the provider; the studio shows them the Etherscan way. */
function normalizeCompilerVersion(version: string | undefined): string {
  if (!version) return 'Unknown';
  return /^\d/.test(version) ? `v${version}` : version;
}

function looksLikeProxy(sourceCode: string): boolean {
  return sourceCode.includes('delegatecall') && sourceCode.includes('implementation');
}

// ============= PROVIDER CONTRACT =============

type ProviderOutcome =
  | { kind: 'found'; contract: FetchedContract }
  | { kind: 'not-found' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'error'; reason: string };

interface SourceProvider {
  name: string;
  lookup(address: string, network: NetworkType, apiKey: string): Promise<ProviderOutcome>;
}

// ============= SOURCIFY =============

interface SourcifyFile {
  content?: string;
}

interface SourcifyCompilation {
  name?: string;
  compilerVersion?: string;
  fullyQualifiedName?: string;
  compilerSettings?: {
    optimizer?: { enabled?: boolean; runs?: number };
  };
}

interface SourcifyProxyResolution {
  isProxy?: boolean;
  implementations?: Array<{ address?: string }>;
}

interface SourcifyContract {
  match?: string | null;
  sources?: Record<string, SourcifyFile>;
  compilation?: SourcifyCompilation;
  proxyResolution?: SourcifyProxyResolution;
}

/** Sourcify v1 (`/files/any`) is in a permanent brownout; v2 is the live API. */
const SOURCIFY_BASE = 'https://sourcify.dev/server/v2/contract';

const sourcifyProvider: SourceProvider = {
  name: 'Sourcify',

  async lookup(address, network) {
    const { chainId } = NETWORKS[network];
    const url = `${SOURCIFY_BASE}/${chainId}/${address}?fields=sources,compilation,proxyResolution`;

    let response: JsonResponse;
    try {
      response = await getJson(url);
    } catch (error) {
      return { kind: 'error', reason: error instanceof Error ? error.message : String(error) };
    }

    if (response.status === 404) return { kind: 'not-found' };
    if (response.status !== 200 || response.body === null) {
      return { kind: 'error', reason: `unusable response (HTTP ${response.status})` };
    }

    const data = response.body as SourcifyContract;
    const entries = Object.entries(data.sources ?? {});
    if (entries.length === 0) return { kind: 'not-found' };

    const files = new Map<string, string>();
    for (const [path, file] of entries) {
      if (typeof file?.content === 'string') files.set(path, file.content);
    }
    if (files.size === 0) return { kind: 'not-found' };

    const fullyQualified = data.compilation?.fullyQualifiedName ?? '';
    const primaryPath = fullyQualified.includes(':')
      ? fullyQualified.slice(0, fullyQualified.lastIndexOf(':'))
      : undefined;

    const sourceCode = assembleSources(files, primaryPath);
    const optimizer = data.compilation?.compilerSettings?.optimizer;
    const implementation = data.proxyResolution?.implementations?.[0]?.address;

    return {
      kind: 'found',
      contract: {
        name: data.compilation?.name || 'Unknown',
        address,
        network,
        sourceCode,
        compiler: normalizeCompilerVersion(data.compilation?.compilerVersion),
        optimizationUsed: optimizer?.enabled === true,
        runs: optimizer?.runs ?? 200,
        // Sourcify verifies against bytecode and does not retain the ABI-encoded
        // constructor arguments, so this stays empty for Sourcify imports.
        constructorArguments: '',
        isVerified: true,
        isProxy: data.proxyResolution?.isProxy === true || looksLikeProxy(sourceCode),
        implementationAddress: implementation,
        sourceProvider: 'Sourcify',
        fileCount: files.size,
      },
    };
  },
};

// ============= ETHERSCAN-SHAPED EXPLORERS (BLOCKSCOUT, ETHERSCAN) =============

interface ExplorerAdditionalSource {
  Filename?: string;
  SourceCode?: string;
}

interface ExplorerResult {
  SourceCode?: string;
  ContractName?: string;
  CompilerVersion?: string;
  OptimizationUsed?: string;
  Runs?: string;
  OptimizationRuns?: number;
  ConstructorArguments?: string;
  Implementation?: string;
  Proxy?: string;
  IsProxy?: string;
  FileName?: string;
  AdditionalSources?: ExplorerAdditionalSource[];
}

interface ExplorerResponse {
  status?: string;
  message?: string;
  result?: ExplorerResult[] | string;
}

/** Etherscan's standard-JSON payload for multi-file contracts is wrapped in an
 * extra pair of braces; single-file contracts arrive as bare Solidity. */
interface StandardJsonInput {
  sources?: Record<string, { content?: string }>;
}

function explorerSourceToFiles(result: ExplorerResult): Map<string, string> {
  const files = new Map<string, string>();
  const raw = result.SourceCode ?? '';
  const primaryPath = result.FileName || `${result.ContractName || 'Contract'}.sol`;

  if (raw.startsWith('{{') || raw.startsWith('{')) {
    const candidate = raw.startsWith('{{') ? raw.slice(1, -1) : raw;
    try {
      const parsed = JSON.parse(candidate) as StandardJsonInput;
      for (const [path, file] of Object.entries(parsed.sources ?? {})) {
        if (typeof file?.content === 'string') files.set(path, file.content);
      }
      if (files.size > 0) return files;
    } catch {
      // Not standard JSON after all - fall through and treat it as flat Solidity.
    }
  }

  files.set(primaryPath, raw);
  // Blockscout returns the dependency files alongside the primary one instead of
  // embedding them in a standard-JSON blob.
  for (const extra of result.AdditionalSources ?? []) {
    if (extra.Filename && typeof extra.SourceCode === 'string') {
      files.set(extra.Filename, extra.SourceCode);
    }
  }

  return files;
}

function explorerResultToContract(
  result: ExplorerResult,
  address: string,
  network: NetworkType,
  providerName: string
): FetchedContract {
  const files = explorerSourceToFiles(result);
  const primaryPath = result.FileName && files.has(result.FileName) ? result.FileName : undefined;
  const sourceCode = assembleSources(files, primaryPath);

  const runs = result.OptimizationRuns ?? Number.parseInt(result.Runs ?? '', 10);

  return {
    name: result.ContractName || 'Unknown',
    address,
    network,
    sourceCode,
    compiler: normalizeCompilerVersion(result.CompilerVersion),
    optimizationUsed: result.OptimizationUsed === '1' || result.OptimizationUsed === 'true',
    runs: Number.isFinite(runs) ? Number(runs) : 200,
    constructorArguments: result.ConstructorArguments ?? '',
    isVerified: true,
    isProxy:
      result.Proxy === '1' || result.IsProxy === 'true' || looksLikeProxy(sourceCode),
    implementationAddress: result.Implementation || undefined,
    sourceProvider: providerName,
    fileCount: files.size,
  };
}

async function lookupEtherscanShaped(
  url: string,
  address: string,
  network: NetworkType,
  providerName: string
): Promise<ProviderOutcome> {
  let response: JsonResponse;
  try {
    response = await getJson(url);
  } catch (error) {
    return { kind: 'error', reason: error instanceof Error ? error.message : String(error) };
  }

  if (response.status !== 200 || response.body === null) {
    return { kind: 'error', reason: `unusable response (HTTP ${response.status})` };
  }

  const data = response.body as ExplorerResponse;

  if (typeof data.result === 'string') {
    // Etherscan reports a bad key or a throttled caller as a bare string result.
    return { kind: 'error', reason: data.result };
  }

  const result = data.result?.[0];
  if (!result || !result.SourceCode) return { kind: 'not-found' };

  return { kind: 'found', contract: explorerResultToContract(result, address, network, providerName) };
}

const blockscoutProvider: SourceProvider = {
  name: 'Blockscout',

  async lookup(address, network) {
    const api = NETWORKS[network].blockscoutApi;
    if (!api) {
      return { kind: 'skipped', reason: `no public Blockscout instance for ${NETWORKS[network].label}` };
    }

    return lookupEtherscanShaped(
      `${api}?module=contract&action=getsourcecode&address=${address}`,
      address,
      network,
      'Blockscout'
    );
  },
};

/** Etherscan's v1 per-chain hosts are retired; v2 is one host keyed by chainid. */
const ETHERSCAN_BASE = 'https://api.etherscan.io/v2/api';

const etherscanProvider: SourceProvider = {
  name: 'Etherscan',

  async lookup(address, network, apiKey) {
    if (!apiKey) return { kind: 'skipped', reason: 'no ETHERSCAN_API_KEY configured' };

    const { chainId } = NETWORKS[network];
    return lookupEtherscanShaped(
      `${ETHERSCAN_BASE}?chainid=${chainId}&module=contract&action=getsourcecode` +
        `&address=${address}&apikey=${encodeURIComponent(apiKey)}`,
      address,
      network,
      'Etherscan'
    );
  },
};

const PROVIDERS: SourceProvider[] = [sourcifyProvider, blockscoutProvider, etherscanProvider];

// ============= RESOLVER =============

/**
 * Fetch verified source for `address`, trying every configured provider in order
 * and returning the first that has the contract.
 */
export async function fetchContractSource(
  address: string,
  network: NetworkType,
  apiKey?: string
): Promise<FetchedContract> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new ContractSourceError(
      'Invalid contract address. Expected a 0x-prefixed 40 character hex address.',
      'invalid-address'
    );
  }

  if (!isNetworkType(network)) {
    throw new ContractSourceError(
      `Unsupported network "${network}". Supported: ${Object.keys(NETWORKS).join(', ')}.`,
      'unsupported-network'
    );
  }

  // Sourcify rejects an address whose EIP-55 casing is wrong with a 400, so a
  // lowercase address pasted from a terminal or a mixed-case one copied from a
  // block explorer would fail for reasons that look like an outage. Normalising
  // once here keeps every provider on the canonical form.
  const normalized = getAddress(address);

  const key = apiKey || process.env.ETHERSCAN_API_KEY || '';
  const attempts: string[] = [];
  // A provider that failed to answer leaves the verdict open: the contract could
  // still be verified there. A skipped provider is not evidence either way.
  let anyProviderFailed = false;

  for (const provider of PROVIDERS) {
    const outcome = await provider.lookup(normalized, network, key);

    switch (outcome.kind) {
      case 'found':
        return outcome.contract;
      case 'not-found':
        attempts.push(`${provider.name} (no verified source)`);
        break;
      case 'skipped':
        attempts.push(`${provider.name} (skipped: ${outcome.reason})`);
        break;
      case 'error':
        anyProviderFailed = true;
        attempts.push(`${provider.name} (${outcome.reason})`);
        break;
    }
  }

  const label = NETWORKS[network].label;
  const tried = attempts.join(', ');

  if (anyProviderFailed) {
    throw new ContractSourceError(
      `Could not reach every source provider for ${address} on ${label}. Tried ${tried}. ` +
        'Try again, or paste the source directly.',
      'unavailable'
    );
  }

  throw new ContractSourceError(
    `No verified source code for ${address} on ${label}. Tried ${tried}. ` +
      'Verify the contract on Sourcify, or paste the source directly.',
    'not-verified'
  );
}
