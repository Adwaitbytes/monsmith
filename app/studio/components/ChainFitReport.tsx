'use client';

import React, { useCallback, useMemo, useState } from 'react';
import type { ChainFitReport as Report, FunctionReport } from '@/lib/chainfit/report';
import type { ChainFinding, FindingImpact } from '@/lib/chainfit/findings';

interface ChainFitReportProps {
  code: string;
  onClose?: () => void;
}

/**
 * Chain Fit panel.
 *
 * The panel is arranged the way the argument runs: what it costs, what that
 * costs in money, then what would have to change. Findings are ordered by how
 * much they matter rather than by how flattering they are, and the ones that
 * count against Monad use the same styling as the ones that count for it. A
 * comparison that visually rewards one answer stops being a measurement.
 */

const IMPACT_STYLES: Record<FindingImpact, { label: string; chip: string; rail: string }> = {
  blocker: {
    label: 'Blocker',
    chip: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
    rail: 'bg-red-500',
  },
  cost: {
    label: 'Cost',
    chip: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
    rail: 'bg-orange-500',
  },
  design: {
    label: 'Design',
    chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    rail: 'bg-amber-500',
  },
  advantage: {
    label: 'Advantage',
    chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    rail: 'bg-emerald-500',
  },
  info: {
    label: 'Context',
    chip: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30',
    rail: 'bg-slate-400',
  },
};

function gasText(value: number | undefined): string {
  if (value === undefined) return '-';
  return value.toLocaleString('en-US');
}

/** Sub-cent costs need more places than currency formatting gives by default. */
function usdText(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  if (value === 0) return '$0';
  if (value < 0.000001) return '<$0.000001';
  if (value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(4)}`;
}

function durationText(ms: number): string {
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.round(ms / 86_400_000)} d`;
}

function deltaText(value: number): string {
  if (value === 0) return 'same';
  const sign = value > 0 ? '+' : '−';
  return `${sign}${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
}

function BasisDot({ basis }: { basis: 'measured' | 'documented' }) {
  const measured = basis === 'measured';
  return (
    <span
      title={measured ? 'Measured from the chain just now' : 'From documentation; the live probe did not answer'}
      className={`inline-block w-1.5 h-1.5 rounded-full align-middle ${
        measured ? 'bg-emerald-500' : 'bg-amber-500'
      }`}
    />
  );
}

function ChainStrip({ report }: { report: Report }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))' }}>
      {report.chains.map((chain) => {
        const blockTime = chain.probe.blockTimeMs;
        const isHome = chain.id === 'monad';
        return (
          <div
            key={chain.id}
            className={`rounded-xl border px-3 py-2.5 ${
              isHome ? 'border-accent-line bg-accent-soft' : 'border-border-subtle panel-sunken'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: chain.accent }} />
              <span className="text-xs font-semibold text-text-primary truncate">{chain.shortName}</span>
            </div>
            <dl className="mt-2 space-y-1 text-[11px] leading-tight">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-text-muted">Block</dt>
                <dd className="font-mono tabular-nums text-text-secondary flex items-center gap-1">
                  {blockTime === null ? '-' : durationText(blockTime.value)}
                  {blockTime !== null && <BasisDot basis={blockTime.basis} />}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-text-muted">Final</dt>
                <dd className="font-mono tabular-nums text-text-secondary">
                  {durationText(chain.hardFinalityMs.value)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-text-muted">Max code</dt>
                <dd className="font-mono tabular-nums text-text-secondary">
                  {Math.round(chain.maxCodeSize.value / 1024)} KB
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-text-muted">Charges</dt>
                <dd className="font-mono text-[10px] text-text-secondary">
                  {chain.gasCharging === 'gas_limit' ? 'gas limit' : 'gas used'}
                </dd>
              </div>
            </dl>
          </div>
        );
      })}
    </div>
  );
}

/** Id of the chain with the lowest priced cost, or null when nothing is priced. */
function cheapestChain(
  chains: Report['chains'],
  cost: Record<string, { usd: number | null } | undefined>,
): string | null {
  let best: { id: string; usd: number } | null = null;
  for (const chain of chains) {
    const usd = cost[chain.id]?.usd;
    if (usd === null || usd === undefined) continue;
    if (best === null || usd < best.usd) best = { id: chain.id, usd };
  }
  return best === null ? null : best.id;
}

function CostRow({
  label,
  sublabel,
  gas,
  cost,
  chains,
  highlight,
}: {
  label: string;
  sublabel?: string;
  gas: Record<string, { totalGas: number } | undefined>;
  cost: Record<string, { usd: number | null } | undefined>;
  chains: Report['chains'];
  highlight?: boolean;
}) {
  // The cheapest chain is marked rather than asserted, so the reader can see
  // when Monad is not the answer.
  const cheapest = cheapestChain(chains, cost);

  return (
    <tr className={`border-b border-border-subtle last:border-b-0 ${highlight ? 'bg-accent-soft/40' : ''}`}>
      <th scope="row" className="text-left py-2 pr-3 align-top">
        <span className="font-mono text-xs text-text-primary break-all">{label}</span>
        {sublabel && <span className="block text-[10px] text-text-muted mt-0.5">{sublabel}</span>}
      </th>
      {chains.map((chain) => {
        const chainGas = gas[chain.id];
        const chainCost = cost[chain.id];
        const isCheapest = cheapest === chain.id;
        return (
          <td key={chain.id} className="py-2 px-1.5 text-right align-top">
            <span
              className={`block font-mono tabular-nums text-xs ${
                isCheapest ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-text-primary'
              }`}
            >
              {usdText(chainCost?.usd)}
            </span>
            <span className="block font-mono tabular-nums text-[10px] text-text-muted">
              {gasText(chainGas?.totalGas)}
            </span>
          </td>
        );
      })}
    </tr>
  );
}

function FunctionDetail({ fn, chains }: { fn: FunctionReport; chains: Report['chains'] }) {
  const [open, setOpen] = useState(false);
  const monad = fn.gas['monad'];
  const ethereum = fn.gas['ethereum'];
  const hasBoth = monad !== undefined && ethereum !== undefined;

  return (
    <li className="border-b border-border-subtle last:border-b-0">
      <button
        onClick={() => setOpen((value) => !value)}
        className="w-full text-left px-1 py-2.5 hover:bg-border-subtle/40 transition-colors rounded"
        aria-expanded={open}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-xs text-text-primary truncate">{fn.signature}</span>
          <span className="flex items-center gap-2 shrink-0">
            {fn.status !== 'ok' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30">
                {fn.status === 'reverted' ? 'reverted' : 'failed'}
              </span>
            )}
            <span
              className={`font-mono tabular-nums text-xs ${
                fn.delta.total > 0
                  ? 'text-orange-600 dark:text-orange-400'
                  : fn.delta.total < 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-text-muted'
              }`}
            >
              {deltaText(fn.delta.total)}
            </span>
          </span>
        </div>
        {hasBoth && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 h-1 rounded-full panel-sunken overflow-hidden">
              <div
                className="h-full rounded-full bg-[#836EF9] transition-[width] duration-500"
                style={{
                  width: `${Math.min(100, (monad.totalGas / Math.max(monad.totalGas, ethereum.totalGas)) * 100)}%`,
                }}
              />
            </div>
            <span className="text-[10px] text-text-muted font-mono tabular-nums w-20 text-right">
              {gasText(monad.totalGas)}
            </span>
          </div>
        )}
      </button>

      {open && (
        <div className="px-1 pb-3 space-y-2">
          {fn.status !== 'ok' && (
            <p className="text-[11px] text-text-secondary leading-relaxed">
              This call {fn.status === 'reverted' ? 'reverted' : 'failed'}
              {fn.revertReason ? ` with "${fn.revertReason}"` : ''} under synthesised arguments, so the
              numbers cover only the path up to that point.
            </p>
          )}
          {fn.explanations.length === 0 ? (
            <p className="text-[11px] text-text-muted">Priced identically on both schedules.</p>
          ) : (
            <ul className="space-y-1.5">
              {fn.explanations.map((item) => (
                <li key={item.component} className="text-[11px] leading-relaxed">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-text-primary">{item.label}</span>
                    <span
                      className={`font-mono tabular-nums shrink-0 ${
                        item.gas > 0
                          ? 'text-orange-600 dark:text-orange-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {deltaText(item.gas)}
                    </span>
                  </span>
                  <span className="block text-text-muted">{item.detail}</span>
                </li>
              ))}
            </ul>
          )}
          {fn.gasSpread !== null && (
            <p className="text-[11px] text-text-secondary leading-relaxed">
              <span className="text-text-muted">Input sensitivity: </span>
              {gasText(fn.gasSpread.minGas)} to {gasText(fn.gasSpread.maxGas)} gas, a{' '}
              {fn.gasSpread.spreadPct}% spread. On Monad the gas limit is what gets charged, so a limit
              set for the worst case is paid on every call.
            </p>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
            {chains.map((chain) => (
              <span key={chain.id} className="text-[10px] text-text-muted font-mono">
                {chain.shortName} {usdText(fn.cost[chain.id]?.usd)}
              </span>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

function FindingCard({ finding, chains }: { finding: ChainFinding; chains: Report['chains'] }) {
  const style = IMPACT_STYLES[finding.impact];
  const nameOf = (id: string) => chains.find((chain) => chain.id === id)?.shortName ?? id;

  return (
    <li className="relative pl-3 py-3 border-b border-border-subtle last:border-b-0">
      <span className={`absolute left-0 top-3 bottom-3 w-0.5 rounded-full ${style.rail}`} />
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-medium text-text-primary leading-snug">{finding.title}</h4>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${style.chip}`}>
          {style.label}
        </span>
      </div>
      <p className="mt-1.5 text-xs text-text-secondary leading-relaxed">{finding.detail}</p>

      {finding.metric && (
        <p className="mt-2 text-[11px] font-mono text-text-primary">
          <span className="text-text-muted">{finding.metric.label}: </span>
          {finding.metric.value}
        </p>
      )}

      {(finding.affects.length > 0 || finding.clearedOn.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {finding.affects.map((id) => (
            <span
              key={`a-${id}`}
              className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-700 dark:text-orange-300"
            >
              affects {nameOf(id)}
            </span>
          ))}
          {finding.clearedOn.map((id) => (
            <span
              key={`c-${id}`}
              className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            >
              clear on {nameOf(id)}
            </span>
          ))}
        </div>
      )}

      {finding.action && (
        <p className="mt-2 text-[11px] text-text-secondary leading-relaxed">
          <span className="text-text-muted">Do: </span>
          {finding.action}
        </p>
      )}
      {finding.source && (
        <a
          href={finding.source}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 inline-block text-[10px] text-accent hover:underline"
        >
          Source
        </a>
      )}
    </li>
  );
}

export function ChainFitReport({ code, onClose }: ChainFitReportProps) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!code.trim()) {
      setError('No code to analyse');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/chain-fit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Chain Fit analysis failed');
      setReport(data.report as Report);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : 'Failed to analyse contract');
    } finally {
      setLoading(false);
    }
  }, [code]);

  // The headline compares Monad against the cheapest alternative rather than
  // against the most expensive one, because picking Ethereum as the baseline
  // would flatter the result.
  const headline = useMemo(() => {
    if (report === null) return null;
    const monadCost = report.deployment.cost['monad']?.usd ?? null;
    let best: { name: string; usd: number } | null = null;
    for (const chain of report.chains) {
      if (chain.id === 'monad') continue;
      const usd = report.deployment.cost[chain.id]?.usd;
      if (usd === null || usd === undefined) continue;
      if (best === null || usd < best.usd) best = { name: chain.shortName, usd };
    }
    if (monadCost === null || monadCost === 0 || best === null) return null;
    return { monadCost, best, ratio: best.usd / monadCost };
  }, [report]);

  return (
    <div className="h-full flex flex-col panel-surface">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <svg
              className="w-5 h-5 text-purple-600 dark:text-purple-400 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
              />
            </svg>
            <span className="font-semibold truncate">Chain Fit</span>
          </div>
          <span className="text-xs bg-purple-500/15 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full font-medium shrink-0">
            Measured
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={run}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Measuring
              </>
            ) : (
              'Compare'
            )}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-border-subtle rounded-lg transition-colors"
              aria-label="Close chain fit report"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-500/15 border border-red-500/40 rounded-lg shrink-0">
          <p className="text-xs text-red-700 dark:text-red-300 whitespace-pre-wrap font-mono leading-relaxed">
            {error}
          </p>
        </div>
      )}

      {report === null && !loading && !error && (
        <div className="flex-1 flex items-center justify-center px-8">
          <div className="text-center max-w-xs">
            <p className="text-sm text-text-secondary leading-relaxed">
              Runs your contract in a local EVM, then reprices that exact execution under each chain&apos;s
              published gas schedule and its live gas price.
            </p>
            <p className="mt-3 text-xs text-text-muted leading-relaxed">
              Nothing here is an estimate of what a contract like yours might cost. It is what this
              contract does cost.
            </p>
          </div>
        </div>
      )}

      {report !== null && (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {headline !== null && (
            <section className="rounded-xl border border-accent-line bg-accent-soft px-4 py-3">
              <p className="text-xs text-text-secondary leading-relaxed">
                Deploying <span className="font-mono text-text-primary">{report.contractName}</span> costs{' '}
                <span className="font-mono text-text-primary">{usdText(headline.monadCost)}</span> on Monad.
                The cheapest alternative here is {headline.best.name} at{' '}
                <span className="font-mono text-text-primary">{usdText(headline.best.usd)}</span>
                {headline.ratio >= 1.1 && (
                  <>
                    , which is {headline.ratio.toFixed(1)}× more
                  </>
                )}
                .
              </p>
            </section>
          )}

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
              Networks, live
            </h3>
            <ChainStrip report={report} />
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
              What it costs
            </h3>
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border-strong">
                    <th className="text-left py-1.5 pr-3 font-medium text-text-muted">Call</th>
                    {report.chains.map((chain) => (
                      <th
                        key={chain.id}
                        className="text-right py-1.5 px-1.5 font-medium text-text-muted whitespace-nowrap"
                      >
                        {chain.shortName}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <CostRow
                    label="deploy"
                    sublabel={`${(report.deployment.runtimeCodeSize / 1024).toFixed(1)} KB runtime`}
                    gas={report.deployment.gas}
                    cost={report.deployment.cost}
                    chains={report.chains}
                    highlight
                  />
                  {report.functions.map((fn) => (
                    <CostRow
                      key={fn.signature}
                      label={fn.name}
                      sublabel={fn.status === 'ok' ? undefined : fn.status}
                      gas={fn.gas}
                      cost={fn.cost}
                      chains={report.chains}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10px] text-text-muted leading-relaxed">
              Top line is cost in USD at the gas price read from each chain just now. Below it, total gas.
            </p>
          </section>

          {report.functions.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">
                Why the numbers differ
              </h3>
              <ul>
                {report.functions.map((fn) => (
                  <FunctionDetail key={fn.signature} fn={fn} chains={report.chains} />
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">
              Findings
            </h3>
            {report.findings.length === 0 ? (
              <p className="text-xs text-text-muted py-2">
                Nothing in this contract behaves differently across the chains compared.
              </p>
            ) : (
              <ul>
                {report.findings.map((finding) => (
                  <FindingCard key={finding.id} finding={finding} chains={report.chains} />
                ))}
              </ul>
            )}
          </section>

          <section className="pt-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
              How to read this
            </h3>
            <ul className="space-y-1.5">
              {report.caveats.map((caveat) => (
                <li key={caveat} className="text-[11px] text-text-muted leading-relaxed pl-3 relative">
                  <span className="absolute left-0 top-1.5 w-1 h-1 rounded-full bg-text-muted" />
                  {caveat}
                </li>
              ))}
              {report.warnings.map((warning) => (
                <li
                  key={warning}
                  className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed pl-3 relative"
                >
                  <span className="absolute left-0 top-1.5 w-1 h-1 rounded-full bg-amber-500" />
                  {warning}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[10px] text-text-muted">
              Generated {new Date(report.generatedAt).toLocaleString('en-US')} · {report.compiledWith}
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

export default ChainFitReport;
