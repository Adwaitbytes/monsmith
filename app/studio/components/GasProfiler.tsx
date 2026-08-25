'use client';

import React, { useCallback, useMemo, useState } from 'react';
import type { FunctionGas, GasClass, GasProfile } from '@/lib/gasProfiler';

interface GasProfilerProps {
  code: string;
  onClose?: () => void;
}

/** Severity ramp: green is safe to call in a loop, red is a function to redesign. */
const CLASS_STYLES: Record<GasClass, { label: string; chip: string; bar: string; dot: string }> = {
  cheap: {
    label: 'Cheap',
    chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    bar: 'bg-emerald-500',
    dot: 'bg-emerald-500',
  },
  moderate: {
    label: 'Moderate',
    chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    bar: 'bg-amber-500',
    dot: 'bg-amber-500',
  },
  expensive: {
    label: 'Expensive',
    chip: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
    bar: 'bg-orange-500',
    dot: 'bg-orange-500',
  },
  unbounded: {
    label: 'Unbounded',
    chip: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
    bar: 'bg-red-500',
    dot: 'bg-red-500',
  },
};

const CLASS_ORDER: GasClass[] = ['unbounded', 'expensive', 'moderate', 'cheap'];

function formatGas(gas: number | null): string {
  return gas === null ? 'unbounded' : gas.toLocaleString('en-US');
}

/** Bars are scaled against the most expensive bounded function, so relative weight reads at a glance. */
function barWidth(fn: FunctionGas, maxGas: number): string {
  if (fn.gas === null) return '100%';
  if (maxGas <= 0) return '0%';
  return `${Math.max(2, (fn.gas / maxGas) * 100)}%`;
}

function FunctionRow({ fn, maxGas }: { fn: FunctionGas; maxGas: number }) {
  const style = CLASS_STYLES[fn.classification];
  const args = fn.signature.slice(fn.signature.indexOf('('));

  return (
    <li className="px-4 py-3 border-b border-border-subtle last:border-b-0">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 translate-y-[-1px] ${style.dot}`} />
          <span className="font-mono text-sm text-text-primary truncate">
            {fn.name}
            <span className="text-text-muted">{args}</span>
          </span>
          {fn.stateMutability && fn.stateMutability !== 'nonpayable' && (
            <span className="text-[11px] text-text-muted shrink-0">{fn.stateMutability}</span>
          )}
        </div>
        <div className="flex items-baseline gap-2 shrink-0">
          <span
            className={`font-mono tabular-nums text-sm ${
              fn.gas === null ? 'text-red-600 dark:text-red-400' : 'text-text-primary'
            }`}
          >
            {formatGas(fn.gas)}
          </span>
          <span className={`text-[11px] px-1.5 py-0.5 rounded border ${style.chip}`}>{style.label}</span>
        </div>
      </div>

      <div className="mt-2 h-1.5 rounded-full panel-sunken overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${style.bar} ${
            fn.gas === null ? 'opacity-40' : ''
          }`}
          style={{ width: barWidth(fn, maxGas) }}
        />
      </div>

      {fn.hint && (
        <p className="mt-2 text-xs text-text-secondary leading-relaxed">
          <span className="text-text-muted">Fix: </span>
          {fn.hint}
        </p>
      )}
    </li>
  );
}

export function GasProfiler({ code, onClose }: GasProfilerProps) {
  const [profile, setProfile] = useState<GasProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInternal, setShowInternal] = useState(false);

  const runProfile = useCallback(async () => {
    if (!code.trim()) {
      setError('No code to profile');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/gas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Gas profiling failed');
      }

      setProfile(data.profile as GasProfile);
    } catch (err) {
      setProfile(null);
      setError(err instanceof Error ? err.message : 'Failed to profile contract');
    } finally {
      setLoading(false);
    }
  }, [code]);

  const shown = useMemo(() => {
    if (!profile) return [];
    return showInternal ? [...profile.functions, ...profile.internalFunctions] : profile.functions;
  }, [profile, showInternal]);

  const sizePercent = profile
    ? Math.min(100, (profile.contractSizeBytes / profile.contractSizeLimitBytes) * 100)
    : 0;

  return (
    <div className="h-full flex flex-col panel-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="font-semibold">Gas Profiler</span>
          </div>
          <span className="text-xs bg-purple-500/15 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full font-medium">
            Static estimate
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runProfile}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Profiling...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Profile
              </>
            )}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-border-subtle rounded-lg transition-colors"
              aria-label="Close gas profiler"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-500/15 border border-red-500/40 rounded-lg">
          <div className="text-sm font-medium text-red-700 dark:text-red-300 mb-1">Could not profile this contract</div>
          <pre className="text-xs text-red-700/90 dark:text-red-300/90 whitespace-pre-wrap font-mono max-h-40 overflow-auto">
            {error}
          </pre>
        </div>
      )}

      {/* Empty state */}
      {!profile && !loading && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-md">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-purple-500/20 to-amber-500/20 flex items-center justify-center">
              <svg className="w-10 h-10 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-text-primary mb-2">Per-function gas costs</h3>
            <p className="text-text-secondary mb-6">
              Compile the contract to see what each function costs to call and what it costs to deploy,
              before you spend anything on chain.
            </p>
            <button
              onClick={runProfile}
              className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-amber-600 hover:from-purple-700 hover:to-amber-700 text-white rounded-lg font-medium transition-all"
            >
              Profile Gas
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 relative">
              <div className="absolute inset-0 rounded-full border-4 border-purple-500/20" />
              <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-purple-500 animate-spin" />
            </div>
            <p className="text-text-secondary">Compiling and estimating gas...</p>
          </div>
        </div>
      )}

      {/* Results */}
      {profile && !loading && (
        <div className="flex-1 overflow-auto">
          {/* Deployment cost, given the most weight because it is paid once and cannot be retried cheaply. */}
          <div className="px-4 py-4 border-b border-border-subtle">
            <div className="panel-sunken rounded-xl border border-border-strong p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-xs uppercase tracking-wider text-text-muted mb-1">Deployment cost</div>
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`text-3xl font-bold tabular-nums ${
                        profile.deployment.unbounded ? 'text-red-600 dark:text-red-400' : 'text-text-primary'
                      }`}
                    >
                      {formatGas(profile.deployment.totalCost)}
                    </span>
                    <span className="text-sm text-text-muted">gas</span>
                  </div>
                  <div className="mt-1 text-xs text-text-secondary">
                    {profile.contractName}
                    {profile.deployment.unbounded && ' - constructor cost depends on its arguments'}
                  </div>
                </div>

                <div className="flex gap-6">
                  <div>
                    <div className="text-xs text-text-muted mb-1">Code deposit</div>
                    <div className="font-mono tabular-nums text-text-primary">
                      {formatGas(profile.deployment.codeDepositCost)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted mb-1">Constructor</div>
                    <div className="font-mono tabular-nums text-text-primary">
                      {formatGas(profile.deployment.executionCost)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Contract size against the EIP-170 limit */}
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-text-muted">Runtime size</span>
                  <span className="text-text-secondary tabular-nums">
                    {profile.contractSizeBytes.toLocaleString('en-US')} / {profile.contractSizeLimitBytes.toLocaleString('en-US')} bytes
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-border-subtle overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                      sizePercent > 90 ? 'bg-red-500' : sizePercent > 70 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.max(1, sizePercent)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Distribution */}
          <div className="px-4 py-3 border-b border-border-subtle flex items-center gap-2 flex-wrap">
            {CLASS_ORDER.map((cls) => {
              const count = profile.summary[cls];
              return (
                <span
                  key={cls}
                  className={`text-xs px-2 py-1 rounded-md border ${CLASS_STYLES[cls].chip} ${
                    count === 0 ? 'opacity-40' : ''
                  }`}
                >
                  {count} {CLASS_STYLES[cls].label.toLowerCase()}
                </span>
              );
            })}
            {profile.internalFunctions.length > 0 && (
              <button
                onClick={() => setShowInternal((value) => !value)}
                className="ml-auto text-xs text-text-secondary hover:text-text-primary transition-colors underline underline-offset-2"
              >
                {showInternal ? 'Hide' : 'Show'} {profile.internalFunctions.length} internal
              </button>
            )}
          </div>

          {/* Functions, most expensive first */}
          {shown.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-text-secondary">
                This contract exposes no callable functions, so there is nothing to profile.
              </p>
            </div>
          ) : (
            <ul>
              {shown.map((fn) => (
                <FunctionRow key={fn.signature} fn={fn} maxGas={profile.summary.maxGas} />
              ))}
            </ul>
          )}

          <p className="px-4 py-4 text-xs text-text-muted leading-relaxed border-t border-border-subtle">
            Figures are solc&apos;s static upper bounds for execution only. They exclude the 21,000 gas base
            transaction cost and calldata. &ldquo;Unbounded&rdquo; means the compiler could not prove a limit,
            usually because of a loop or a call into another contract, not that the function is necessarily slow.
          </p>
        </div>
      )}
    </div>
  );
}

export default GasProfiler;
