'use client';

import React, { useCallback, useState } from 'react';
import Link from 'next/link';

import type { ChainFitReport as Report } from '@/lib/chainfit/report';
import type { FindingImpact } from '@/lib/chainfit/findings';
import { track } from '@/lib/track';

import { SAMPLE_CONTRACTS } from './samples';

/**
 * The interactive half of the compare page: paste a contract, get the numbers.
 *
 * Sample contracts are offered because the argument is only convincing on a
 * real contract, and a visitor who has to go and find one leaves instead. Each
 * sample is chosen to make a different point, including one where Monad is the
 * more expensive answer.
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

function usdText(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  if (value === 0) return '$0';
  if (value < 0.000001) return '<$0.000001';
  if (value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(4)}`;
}

function gasText(value: number | undefined): string {
  return value === undefined ? '-' : value.toLocaleString('en-US');
}

function deltaText(value: number): string {
  if (value === 0) return 'same';
  return `${value > 0 ? '+' : '−'}${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
}

export function CompareClient() {
  const [source, setSource] = useState(SAMPLE_CONTRACTS[0].source);
  const [activeSample, setActiveSample] = useState(SAMPLE_CONTRACTS[0].id);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!source.trim()) {
      setError('Paste a contract first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/chain-fit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: source }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Analysis failed');
      setReport(data.report as Report);
      track('chain_fit', { detail: { surface: 'compare', sample: activeSample } });
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setLoading(false);
    }
  }, [source, activeSample]);

  const selectSample = (id: string) => {
    const sample = SAMPLE_CONTRACTS.find((entry) => entry.id === id);
    if (sample === undefined) return;
    setActiveSample(id);
    setSource(sample.source);
    setReport(null);
    setError(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {SAMPLE_CONTRACTS.map((sample) => (
          <button
            key={sample.id}
            onClick={() => selectSample(sample.id)}
            className={`rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${
              activeSample === sample.id
                ? 'border-accent-line bg-accent-soft text-text-primary'
                : 'border-border-subtle text-text-secondary hover:border-border-strong hover:text-text-primary'
            }`}
          >
            {sample.label}
          </button>
        ))}
      </div>

      <p className="text-[13px] leading-relaxed text-text-secondary">
        {SAMPLE_CONTRACTS.find((sample) => sample.id === activeSample)?.point}
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <label className="block">
          <span className="sr-only">Solidity source</span>
          <textarea
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setActiveSample('custom');
            }}
            spellCheck={false}
            rows={14}
            className="w-full resize-y rounded-2xl border border-border-subtle bg-surface-sunken p-4 font-mono text-[12.5px] leading-relaxed text-text-primary outline-none transition-colors focus:border-accent-line"
            placeholder="Paste a Solidity contract"
          />
        </label>

        <button
          onClick={run}
          disabled={loading}
          className="w-full rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 lg:w-auto"
        >
          {loading ? 'Measuring' : 'Measure it'}
        </button>
      </div>

      {error !== null && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4">
          <p className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-red-700 dark:text-red-300">
            {error}
          </p>
        </div>
      )}

      {loading && (
        <p className="text-[13px] text-text-muted">
          Compiling, deploying into a local EVM, tracing every function, then repricing that
          execution under each chain&apos;s schedule. A few seconds.
        </p>
      )}

      {report !== null && <ReportView report={report} />}
    </div>
  );
}

function ReportView({ report }: { report: Report }) {
  const monadDeploy = report.deployment.cost['monad']?.usd ?? null;
  let cheapestAlternative: { name: string; usd: number } | null = null;
  for (const chain of report.chains) {
    if (chain.id === 'monad') continue;
    const usd = report.deployment.cost[chain.id]?.usd;
    if (usd === null || usd === undefined) continue;
    if (cheapestAlternative === null || usd < cheapestAlternative.usd) {
      cheapestAlternative = { name: chain.shortName, usd };
    }
  }

  return (
    <div className="space-y-10 pt-4">
      <section>
        <h3 className="font-display text-2xl font-semibold tracking-tight text-text-primary">
          {report.contractName}
        </h3>
        {monadDeploy !== null && cheapestAlternative !== null && (
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-text-secondary">
            Deploying costs{' '}
            <span className="font-mono text-text-primary">{usdText(monadDeploy)}</span> on Monad
            against <span className="font-mono text-text-primary">{usdText(cheapestAlternative.usd)}</span>{' '}
            on {cheapestAlternative.name}, the cheapest of the alternatives compared here.
            {report.deployment.blockedOn.length > 0 && (
              <>
                {' '}
                It does not deploy at all on{' '}
                {report.deployment.blockedOn
                  .map((id) => report.chains.find((chain) => chain.id === id)?.shortName ?? id)
                  .join(', ')}
                , where it exceeds the 24 KB contract size limit.
              </>
            )}
          </p>
        )}
      </section>

      <section>
        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          Cost per call, at the gas price read from each chain just now
        </h4>
        <div className="overflow-x-auto rounded-2xl border border-border-subtle">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="bg-surface-sunken/60">
                <th className="border-b border-border-strong px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  Call
                </th>
                {report.chains.map((chain) => (
                  <th
                    key={chain.id}
                    className="whitespace-nowrap border-b border-border-strong px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-text-muted"
                  >
                    {chain.shortName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                {
                  key: 'deploy',
                  label: 'deploy',
                  note: `${(report.deployment.runtimeCodeSize / 1024).toFixed(1)} KB`,
                  gas: report.deployment.gas,
                  cost: report.deployment.cost,
                  home: true,
                },
                ...report.functions.map((fn) => ({
                  key: fn.signature,
                  label: fn.name,
                  note: fn.status === 'ok' ? null : fn.status,
                  gas: fn.gas,
                  cost: fn.cost,
                  home: false,
                })),
              ].map((row) => {
                let best: { id: string; usd: number } | null = null;
                for (const chain of report.chains) {
                  const usd = row.cost[chain.id]?.usd;
                  if (usd === null || usd === undefined) continue;
                  if (best === null || usd < best.usd) best = { id: chain.id, usd };
                }
                const cheapest = best === null ? null : best.id;
                return (
                  <tr key={row.key} className={row.home ? 'bg-accent-soft/40' : undefined}>
                    <th scope="row" className="border-b border-border-subtle px-3 py-2.5 text-left">
                      <span className="font-mono text-[13px] text-text-primary">{row.label}</span>
                      {row.note !== null && (
                        <span className="ml-2 text-[11px] text-text-muted">{row.note}</span>
                      )}
                    </th>
                    {report.chains.map((chain) => (
                      <td
                        key={chain.id}
                        className="whitespace-nowrap border-b border-border-subtle px-3 py-2.5 text-right"
                      >
                        <span
                          className={`block font-mono text-[13px] tabular-nums ${
                            cheapest === chain.id
                              ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                              : 'text-text-primary'
                          }`}
                        >
                          {usdText(row.cost[chain.id]?.usd)}
                        </span>
                        <span className="block font-mono text-[11px] tabular-nums text-text-muted">
                          {gasText(row.gas[chain.id]?.totalGas)}
                        </span>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {report.functions.some((fn) => fn.explanations.length > 0) && (
        <section>
          <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            Where the gas difference comes from
          </h4>
          <ul className="space-y-4">
            {report.functions
              .filter((fn) => fn.explanations.length > 0)
              .map((fn) => (
                <li key={fn.signature} className="rounded-xl border border-border-subtle p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-[13px] text-text-primary">{fn.signature}</span>
                    <span
                      className={`font-mono text-[13px] tabular-nums ${
                        fn.delta.total > 0
                          ? 'text-orange-600 dark:text-orange-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {deltaText(fn.delta.total)} gas on Monad
                    </span>
                  </div>
                  <ul className="mt-2.5 space-y-1.5">
                    {fn.explanations.map((item) => (
                      <li key={item.component} className="text-[12.5px] leading-relaxed">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="text-text-primary">{item.label}</span>
                          <span
                            className={`shrink-0 font-mono tabular-nums ${
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
                </li>
              ))}
          </ul>
        </section>
      )}

      <section>
        <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          Findings
        </h4>
        <ul>
          {report.findings.map((finding) => {
            const style = IMPACT_STYLES[finding.impact];
            return (
              <li
                key={finding.id}
                className="relative border-b border-border-subtle py-4 pl-4 last:border-b-0"
              >
                <span className={`absolute bottom-4 left-0 top-4 w-0.5 rounded-full ${style.rail}`} />
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h5 className="text-[15px] font-medium leading-snug text-text-primary">
                    {finding.title}
                  </h5>
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${style.chip}`}>
                    {style.label}
                  </span>
                </div>
                <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-text-secondary">
                  {finding.detail}
                </p>
                {finding.metric !== null && (
                  <p className="mt-2 font-mono text-[12px] text-text-primary">
                    <span className="text-text-muted">{finding.metric.label}: </span>
                    {finding.metric.value}
                  </p>
                )}
                {finding.action !== null && (
                  <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-text-secondary">
                    <span className="text-text-muted">Do: </span>
                    {finding.action}
                  </p>
                )}
                {finding.source !== null && (
                  <a
                    href={finding.source}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 inline-block text-[12px] text-accent hover:underline"
                  >
                    Source
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-2xl border border-border-subtle bg-surface-sunken/50 p-5">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          How to read this
        </h4>
        <ul className="mt-3 space-y-2">
          {[...report.caveats, ...report.warnings].map((line) => (
            <li key={line} className="relative pl-4 text-[12.5px] leading-relaxed text-text-muted">
              <span className="absolute left-0 top-2 h-1 w-1 rounded-full bg-text-muted" />
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12px] text-text-muted">
          Want this against your own contract as you write it?{' '}
          <Link href="/studio" className="text-accent hover:underline">
            Open the studio
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
