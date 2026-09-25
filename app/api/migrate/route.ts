/**
 * Contract Migration API Endpoint
 *
 * Fetches verified contracts from Sourcify, Blockscout or Etherscan, analyzes
 * them for Monad compatibility, and provides optimized code with auto-fixes.
 */

import { NextResponse } from 'next/server';
import {
  fetchContractSource,
  analyzeForMigration,
  ContractSourceError,
  NETWORKS,
  isNetworkType,
  MigrationResult,
} from '@/lib/migrationTool';
import { getApiViewer } from "@/lib/auth/server";
import { LIMITS, rateLimit, tooManyRequests } from "@/lib/rateLimit";

// Rate limiting: simple in-memory cache
const requestCache = new Map<string, { result: MigrationResult; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function POST(req: Request) {
    // Metered before any work: this route spends real compute for
    // anyone who asks, and nothing was counting how often.
    const viewer = await getApiViewer();
    const budget = await rateLimit(req, LIMITS.compute, viewer.userId);
    if (!budget.ok) return tooManyRequests(budget, "migrations");

  const startTime = Date.now();

  try {
    const body = await req.json();
    const {
      mode,
      address,
      network: rawNetwork = 'ethereum',
      code,
      autoFix = true,
    } = body;

    // Validate mode
    if (!mode || !['address', 'code'].includes(mode)) {
      return NextResponse.json(
        { success: false, error: 'Invalid mode. Use "address" or "code".' },
        { status: 400 }
      );
    }

    // Address mode: resolve verified source from the explorer chain
    if (mode === 'address') {
      if (!address) {
        return NextResponse.json(
          { success: false, error: 'Address is required for address mode.' },
          { status: 400 }
        );
      }

      // Validate address format
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return NextResponse.json(
          { success: false, error: 'Invalid Ethereum address format.' },
          { status: 400 }
        );
      }

      // Validate network
      // 'mainnet' is accepted as a legacy alias for the Ethereum source chain.
      const network = rawNetwork === 'mainnet' ? 'ethereum' : rawNetwork;

      if (!isNetworkType(network)) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid network. Use one of: ${Object.keys(NETWORKS).join(', ')}.`,
          },
          { status: 400 }
        );
      }

      // Check cache
      const cacheKey = `${address}-${network}-${autoFix}`;
      const cached = requestCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return NextResponse.json({
          success: true,
          ...cached.result,
          cached: true,
        });
      }

      try {
        // Sourcify first, then Blockscout, then Etherscan if a key is configured
        const contractInfo = await fetchContractSource(
          address,
          network,
          process.env.ETHERSCAN_API_KEY
        );

        // Analyze for migration
        const result = await analyzeForMigration(
          contractInfo.sourceCode,
          contractInfo,
          autoFix
        );

        // Cache result
        requestCache.set(cacheKey, { result, timestamp: Date.now() });

        // Clean old cache entries
        cleanCache();

        return NextResponse.json({
          success: true,
          ...result,
          metadata: {
            ...result.metadata,
            analysisTimeMs: Date.now() - startTime,
          },
        });
      } catch (fetchError) {
        if (fetchError instanceof ContractSourceError) {
          const status = fetchError.failure === 'unavailable' ? 502 : 400;
          return NextResponse.json(
            {
              success: false,
              error: fetchError.message,
              suggestion:
                fetchError.failure === 'not-verified'
                  ? 'Use "code" mode instead and paste the contract source code.'
                  : undefined,
            },
            { status }
          );
        }

        throw fetchError;
      }
    }

    // Code mode: analyze provided code
    if (mode === 'code') {
      if (!code || typeof code !== 'string' || code.trim().length === 0) {
        return NextResponse.json(
          { success: false, error: 'Code is required for code mode.' },
          { status: 400 }
        );
      }

      // Validate it looks like Solidity code
      if (!code.includes('pragma solidity') && !code.includes('contract ') && !code.includes('interface ')) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid Solidity code. Code must contain pragma, contract, or interface definitions.',
          },
          { status: 400 }
        );
      }

      // Analyze the code
      const result = await analyzeForMigration(code, undefined, autoFix);

      return NextResponse.json({
        success: true,
        ...result,
        metadata: {
          ...result.metadata,
          analysisTimeMs: Date.now() - startTime,
        },
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid request.' },
      { status: 400 }
    );
  } catch (error) {
          const message = error instanceof Error ? error.message : "Unexpected server error";
    console.error('Migration API Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: message || 'An unexpected error occurred during migration analysis.',
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    name: 'Contract Migration API',
    version: '1.1.0',
    description: 'Fetch and analyze verified contracts for Monad compatibility',
    sources: ['Sourcify (no API key)', 'Blockscout (no API key)', 'Etherscan (needs ETHERSCAN_API_KEY)'],
    networks: Object.keys(NETWORKS),
    endpoints: {
      POST: {
        description: 'Analyze a contract for migration',
        modes: {
          address: {
            description: 'Fetch verified contract source by address',
            parameters: {
              mode: '"address"',
              address: 'Contract address (0x...)',
              network: `${Object.keys(NETWORKS).map((n) => `"${n}"`).join(' | ')} (default: ethereum)`,
              autoFix: 'boolean (default: true)',
            },
          },
          code: {
            description: 'Analyze provided Solidity code',
            parameters: {
              mode: '"code"',
              code: 'Solidity source code string',
              autoFix: 'boolean (default: true)',
            },
          },
        },
      },
    },
    compatibilityChecks: [
      'SELFDESTRUCT usage (critical)',
      'tx.origin authorization (high)',
      'Unchecked external calls (high)',
      'block.difficulty/prevrandao (medium)',
      'Timestamp dependencies (medium)',
      'Old Solidity versions (low)',
      'Missing SPDX license (info)',
      'Inline assembly (info)',
      'Delegatecall usage (info)',
    ],
    autoFixes: [
      'Add SPDX license identifier',
      'Update pragma to ^0.8.24',
      'Replace tx.origin with msg.sender',
      'Replace block.difficulty with block.prevrandao',
    ],
  });
}

/**
 * Clean expired cache entries
 */
function cleanCache() {
  const now = Date.now();
  for (const [key, value] of requestCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      requestCache.delete(key);
    }
  }
}
