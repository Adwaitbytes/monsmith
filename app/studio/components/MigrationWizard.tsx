'use client';

import React, { useState, useCallback } from 'react';

import { sourceKeyOf, useAnalysisStore } from '@/lib/analysisStore';
import { DiffViewer } from './DiffViewer';
import type { CodeChange } from '@/lib/migrationTool';

type WizardStep = 'input' | 'analyzing' | 'results' | 'diff';
type InputMode = 'address' | 'code';
type NetworkType = 'ethereum' | 'sepolia' | 'monad-testnet' | 'monad-mainnet';

interface MigrationResult {
  contract: {
    name: string;
    address?: string;
    network?: string;
    sourceCode: string;
    compiler: string;
    isVerified: boolean;
    sourceProvider?: string;
    fileCount?: number;
    isProxy?: boolean;
    implementationAddress?: string;
  };
  analysis: {
    compatibilityScore: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    issues: Array<{
      severity: string;
      type: string;
      title: string;
      description: string;
      line?: number;
      code?: string;
      fix?: {
        description: string;
        replacement?: string;
        autoFixable: boolean;
      };
    }>;
    parallelScore: number;
    parallelGrade: string;
  };
  migration: {
    originalCode: string;
    migratedCode: string;
    changes: CodeChange[];
    autoFixedCount: number;
    manualFixCount: number;
    /** Whether the migrated source actually compiles. */
    compiles?: boolean;
    compileErrors?: string[];
  };
  metadata: {
    analysisTimeMs: number;
    timestamp: string;
  };
}

/**
 * Import paths the compiler could not resolve, read from its diagnostics.
 */
function missingImports(errors: string[] | undefined): string[] {
  const paths = new Set<string>();
  for (const message of errors ?? []) {
    for (const match of message.matchAll(/Source "([^"]+)" not found/g)) paths.add(match[1]);
  }
  return [...paths];
}

/**
 * Warns before someone imports a file that cannot be built.
 *
 * Pasting one file of a multi-file project is the easy mistake to make, because
 * a block explorer's source tab shows exactly that and it looks complete. The
 * analysis still runs, the compatibility issues are still real, and the import
 * still produces a file, which then fails to compile for a reason that has
 * nothing to do with the migration. The analysis already knew; it just was not
 * being shown.
 */
function BuildWarning({ result }: { result: MigrationResult }) {
  if (result.migration.compiles !== false) return null;

  const missing = missingImports(result.migration.compileErrors);
  const isMultiFile = missing.length > 0;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
      <h4 className="text-sm font-medium text-amber-700 dark:text-amber-300">
        {isMultiFile
          ? 'This is one file of a multi-file project'
          : 'The migrated contract does not compile'}
      </h4>

      {isMultiFile ? (
        <>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-secondary">
            It imports {missing.length} file{missing.length === 1 ? '' : 's'} that were not pasted
            with it, so importing it here produces something that cannot be compiled. A block
            explorer&apos;s source tab shows one file at a time, which is the usual way to end up
            here.
          </p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-text-secondary">
            Use <span className="font-medium text-text-primary">Address</span> mode above with the
            contract&apos;s address instead. Every file is fetched and flattened into one document
            that compiles.
          </p>
          <p className="mt-2 font-mono text-[11px] text-text-muted break-all">
            {missing.slice(0, 3).join(', ')}
            {missing.length > 3 ? ` and ${missing.length - 3} more` : ''}
          </p>
        </>
      ) : (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-secondary">
          {result.migration.compileErrors?.[0]?.split('\n')[0] ??
            'The compiler rejected the migrated source.'}
        </p>
      )}
    </div>
  );
}

interface MigrationWizardProps {
  onImportCode: (code: string, fileName: string) => void;
  onClose: () => void;
}

export function MigrationWizard({ onImportCode, onClose }: MigrationWizardProps) {
  /**
   * The analysis lives in the shared store rather than in this component.
   *
   * Only one panel can be docked at a time, so opening the gas profiler
   * unmounts this one, and with the result in component state a migration that
   * took several seconds and a round trip to Sourcify was simply gone. Coming
   * back showed an empty form, which reads as though nothing had been run.
   */
  const cachedEntry = useAnalysisStore((state) => state.entries.migration);
  const saveEntry = useAnalysisStore((state) => state.save);
  const clearEntry = useAnalysisStore((state) => state.clear);
  const cachedResult = (cachedEntry?.result ?? null) as MigrationResult | null;

  const [step, setStep] = useState<WizardStep>(cachedResult === null ? 'input' : 'results');
  // Address import resolves through Sourcify and Blockscout, so it needs no API
  // key and is the faster path for the common case of an already-verified contract.
  const [inputMode, setInputMode] = useState<InputMode>('address');
  const [network, setNetwork] = useState<NetworkType>('ethereum');
  const [address, setAddress] = useState('');
  const [pastedCode, setPastedCode] = useState('');
  const result = cachedResult;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A': return 'text-green-600 dark:text-green-400';
      case 'B': return 'text-accent dark:text-accent';
      case 'C': return 'text-yellow-400';
      case 'D': return 'text-orange-600 dark:text-orange-400';
      case 'F': return 'text-red-600 dark:text-red-400';
      default: return 'text-text-secondary';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30';
      case 'high': return 'bg-orange-500/20 text-orange-600 dark:text-orange-400 border-orange-500/30';
      case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'low': return 'bg-accent/20 text-accent dark:text-accent border-accent-line/30';
      case 'info': return 'bg-surface-overlay/20 text-text-secondary border-gray-500/30';
      default: return 'bg-surface-overlay/20 text-text-secondary border-gray-500/30';
    }
  };

  const analyzeContract = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStep('analyzing');
    setProgress(0);

    try {
      // Simulate progress steps
      setProgressText('Preparing request...');
      setProgress(10);
      await new Promise(r => setTimeout(r, 200));

      if (inputMode === 'address') {
        setProgressText('Looking up verified source...');
        setProgress(30);
      } else {
        setProgressText('Parsing contract code...');
        setProgress(30);
      }

      const response = await fetch('/api/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: inputMode,
          address: inputMode === 'address' ? address : undefined,
          network: inputMode === 'address' ? network : undefined,
          code: inputMode === 'code' ? pastedCode : undefined,
          autoFix: true,
        }),
      });

      setProgressText('Checking Monad compatibility...');
      setProgress(60);
      await new Promise(r => setTimeout(r, 300));

      setProgressText('Analyzing parallel execution potential...');
      setProgress(80);
      await new Promise(r => setTimeout(r, 200));

      const data = await response.json();

      setProgressText('Generating optimizations...');
      setProgress(100);
      await new Promise(r => setTimeout(r, 200));

      if (!data.success) {
        throw new Error(data.error || 'Migration analysis failed');
      }

      // Keyed by the input, so a different address or a different paste is a
      // different analysis rather than a silent overwrite.
      const identity = inputMode === 'address' ? `${network}:${address}` : pastedCode;
      saveEntry('migration', sourceKeyOf(identity), data as MigrationResult);
      setStep('results');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze contract');
      setStep('input');
    } finally {
      setLoading(false);
    }
  }, [inputMode, address, network, pastedCode, saveEntry]);

  const handleImportOriginal = () => {
    if (result) {
      const fileName = `${result.contract.name}_original.sol`;
      onImportCode(result.migration.originalCode, fileName);
    }
  };

  const handleImportMigrated = () => {
    if (result) {
      const fileName = `${result.contract.name}_monad.sol`;
      onImportCode(result.migration.migratedCode, fileName);
    }
  };

  const resetWizard = () => {
    setStep('input');
    clearEntry('migration');
    setError(null);
    setProgress(0);
  };

  return (
    <div className="h-full flex flex-col panel-surface text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-accent dark:text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <span className="font-semibold">Contract Migration</span>
          </div>
          <span className="text-xs bg-accent/15 text-accent dark:text-accent dark:text-accent px-2 py-0.5 rounded-full font-medium">
            ETH → Monad
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-border-subtle rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-700 dark:text-red-300 text-sm flex items-start gap-2">
          <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <div className="font-medium">Error</div>
            <div className="text-red-700 dark:text-red-300/80">{error}</div>
          </div>
        </div>
      )}

      {/* Step: Input */}
      {step === 'input' && (
        <div className="flex-1 p-4 overflow-auto">
          <div className="max-w-md mx-auto space-y-6">
            {/* Input Mode Toggle */}
            <div className="flex panel-surface rounded-lg p-1">
              <button
                onClick={() => setInputMode('address')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                  inputMode === 'address'
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-white'
                }`}
              >
                From Address
              </button>
              <button
                onClick={() => setInputMode('code')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                  inputMode === 'code'
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-white'
                }`}
              >
                Paste Code
              </button>
            </div>

            {/* Address Input */}
            {inputMode === 'address' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Network
                  </label>
                  <select
                    value={network}
                    onChange={(e) => setNetwork(e.target.value as NetworkType)}
                    className="w-full px-4 py-2.5 panel-surface border border-border-subtle rounded-lg text-white focus:border-accent-line focus:outline-none"
                  >
                    <option value="ethereum">Ethereum Mainnet</option>
                    <option value="sepolia">Sepolia Testnet</option>
                    <option value="monad-testnet">Monad Testnet</option>
                    <option value="monad-mainnet">Monad Mainnet</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Contract Address
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="0x..."
                    className="w-full px-4 py-2.5 panel-surface border border-border-subtle rounded-lg text-white placeholder-gray-600 focus:border-accent-line focus:outline-none font-mono"
                  />
                  <p className="mt-1 text-xs text-text-muted">
                    Any contract verified on Sourcify, Blockscout or Etherscan. No API key needed.
                  </p>
                </div>
              </div>
            )}

            {/* Code Input */}
            {inputMode === 'code' && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Solidity Code
                </label>
                <textarea
                  value={pastedCode}
                  onChange={(e) => setPastedCode(e.target.value)}
                  placeholder="// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MyContract {
    // Paste your contract code here...
}"
                  rows={12}
                  className="w-full px-4 py-3 panel-surface border border-border-subtle rounded-lg text-white placeholder-gray-600 focus:border-accent-line focus:outline-none font-mono text-sm resize-none"
                />
              </div>
            )}

            {/* Analyze Button */}
            <button
              onClick={analyzeContract}
              disabled={loading || (inputMode === 'address' && !address) || (inputMode === 'code' && !pastedCode)}
              /* A disabled button should read as unavailable, not as a filled
                 dark one. The gradient also survived the move to tokens and was
                 the last place a second colour system was still visible. */
              className="w-full rounded-lg py-3 text-sm font-semibold outline-none ring-accent-line transition-colors focus-visible:ring-2 enabled:bg-accent enabled:text-white enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:border disabled:border-border-subtle disabled:bg-transparent disabled:text-text-muted"
            >
              Analyze for Monad Migration
            </button>

            {/* Info Box */}
            <div className="p-4 bg-accent/10 border border-accent-line/30 rounded-lg">
              <h4 className="font-medium text-accent dark:text-accent mb-2">What happens during analysis?</h4>
              <ul className="space-y-1 text-sm text-text-secondary">
                <li className="flex items-center gap-2">
                  <span className="text-accent dark:text-accent">1.</span>
                  Fetch verified source from Sourcify or Blockscout
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-accent dark:text-accent">2.</span>
                  Check for Monad compatibility issues
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-accent dark:text-accent">3.</span>
                  Analyze parallel execution potential
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-accent dark:text-accent">4.</span>
                  Auto-fix safe issues & suggest optimizations
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Step: Analyzing */}
      {step === 'analyzing' && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center max-w-sm">
            <div className="w-32 h-32 mx-auto mb-6 relative">
              {/* Progress Circle */}
              <svg className="w-full h-full -rotate-90">
                <circle
                  cx="64"
                  cy="64"
                  r="56"
                  stroke="currentColor"
                  strokeWidth="8"
                  fill="none"
                  className="text-white"
                />
                <circle
                  cx="64"
                  cy="64"
                  r="56"
                  stroke="url(#progressGradient)"
                  strokeWidth="8"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${(progress / 100) * 351.86} 351.86`}
                  className="transition-all duration-500"
                />
                <defs>
                  <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#3b82f6" />
                    <stop offset="100%" stopColor="#8b5cf6" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold text-text-primary">{progress}%</span>
              </div>
            </div>
            <h3 className="text-lg font-semibold mb-2">Analyzing Contract</h3>
            <p className="text-text-secondary text-sm">{progressText}</p>
          </div>
        </div>
      )}

      {/* Step: Results */}
      {step === 'results' && result && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Score Overview */}
          <div className="px-4 py-4 border-b border-border-subtle">
            <div className="flex items-center gap-6">
              {/* Contract Info */}
              <div className="flex-1">
                <h3 className="font-semibold text-lg">{result.contract.name}</h3>
                {result.contract.address && (
                  <p className="text-xs text-text-muted font-mono mt-1">
                    {result.contract.address.slice(0, 10)}...{result.contract.address.slice(-8)}
                  </p>
                )}
                <p className="text-xs text-text-muted mt-1">
                  Compiler: {result.contract.compiler}
                  {result.contract.sourceProvider && ` · via ${result.contract.sourceProvider}`}
                  {result.contract.fileCount && result.contract.fileCount > 1 &&
                    ` · ${result.contract.fileCount} files`}
                </p>
                {result.contract.isProxy && result.contract.implementationAddress && (
                  <p className="mt-1 text-xs text-yellow-500/90">
                    Proxy contract. The logic lives at {result.contract.implementationAddress} -                     import that address to analyze the implementation.
                  </p>
                )}
              </div>

              {/* Scores */}
              <div className="flex gap-4">
                {/* Compatibility Score */}
                <div className="text-center">
                  <div className="w-16 h-16 relative">
                    <svg className="w-full h-full -rotate-90">
                      <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="none" className="text-text-primary" />
                      <circle
                        cx="32"
                        cy="32"
                        r="28"
                        stroke={result.analysis.compatibilityScore >= 60 ? '#22c55e' : '#ef4444'}
                        strokeWidth="4"
                        fill="none"
                        strokeLinecap="round"
                        strokeDasharray={`${(result.analysis.compatibilityScore / 100) * 175.93} 175.93`}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={`text-sm font-bold ${getGradeColor(result.analysis.grade)}`}>
                        {result.analysis.grade}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-text-muted mt-1">Compat</div>
                </div>

                {/* Parallel Score */}
                <div className="text-center">
                  <div className="w-16 h-16 relative">
                    <svg className="w-full h-full -rotate-90">
                      <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="none" className="text-text-primary" />
                      <circle
                        cx="32"
                        cy="32"
                        r="28"
                        stroke={result.analysis.parallelScore >= 60 ? '#8b5cf6' : '#f59e0b'}
                        strokeWidth="4"
                        fill="none"
                        strokeLinecap="round"
                        strokeDasharray={`${(result.analysis.parallelScore / 100) * 175.93} 175.93`}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-sm font-bold text-purple-600 dark:text-purple-400">
                        {result.analysis.parallelGrade}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-text-muted mt-1">Parallel</div>
                </div>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <BuildWarning result={result} />

            {/* Changes Summary */}
            <div className="p-4 panel-surface/50 rounded-lg border border-border-subtle">
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Migration Summary
              </h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <span className="text-text-secondary">Auto-fixed:</span>
                  <span className="font-medium">{result.migration.autoFixedCount}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                  <span className="text-text-secondary">Manual review:</span>
                  <span className="font-medium">{result.migration.manualFixCount}</span>
                </div>
              </div>
            </div>

            {/* Issues List */}
            {result.analysis.issues.length > 0 && (
              <div className="p-4 panel-surface/50 rounded-lg border border-border-subtle">
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <svg className="w-4 h-4 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Compatibility Issues ({result.analysis.issues.length})
                </h4>
                <div className="space-y-2 max-h-48 overflow-auto">
                  {result.analysis.issues.map((issue, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border ${getSeverityColor(issue.severity)}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded border ${getSeverityColor(issue.severity)}`}>
                          {issue.severity.toUpperCase()}
                        </span>
                        <span className="text-sm font-medium">{issue.title}</span>
                        {issue.line && (
                          <span className="text-xs text-text-muted">Line {issue.line}</span>
                        )}
                      </div>
                      <p className="text-sm text-text-secondary">{issue.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setStep('diff')}
                className="flex-1 py-2.5 bg-border-subtle hover:bg-surface-overlay rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                View Changes
              </button>
              <button
                onClick={handleImportMigrated}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-semibold text-white outline-none ring-accent-line transition-opacity hover:opacity-90 focus-visible:ring-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Import Optimized
              </button>
            </div>

            {/* Alternative Import */}
            <button
              onClick={handleImportOriginal}
              className="w-full py-2 text-sm text-text-secondary hover:text-white transition-colors"
            >
              Or import original without changes
            </button>
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-border-subtle flex items-center justify-between text-xs text-text-muted">
            <span>Analysis time: {result.metadata.analysisTimeMs}ms</span>
            <button onClick={resetWizard} className="text-accent dark:text-accent hover:text-accent dark:text-accent">
              Analyze Another
            </button>
          </div>
        </div>
      )}

      {/* Step: Diff View */}
      {step === 'diff' && result && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Diff Header */}
          <div className="px-4 py-2 border-b border-border-subtle flex items-center justify-between">
            <button
              onClick={() => setStep('results')}
              className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Results
            </button>
            <button
              onClick={handleImportMigrated}
              className="px-4 py-1.5 bg-accent hover:bg-accent rounded-lg text-sm font-medium transition-colors"
            >
              Import Optimized Code
            </button>
          </div>

          {/* Diff Content */}
          <div className="flex-1 overflow-hidden">
            <DiffViewer
              original={result.migration.originalCode}
              modified={result.migration.migratedCode}
              changes={result.migration.changes}
              isDark={true}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default MigrationWizard;
