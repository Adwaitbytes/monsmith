'use client';

import React, { useState } from 'react';
import Link from 'next/link';

import type { StageContent, Tone } from '@/lib/chainfit/journey';

/**
 * The development journey as a stepper.
 *
 * The devrels asked for the parameters across the development journey, so the
 * journey is the spine and each stage carries exactly one parameter that decides
 * something. Every chain is rendered identically: no chain is dimmed, greyed or
 * given extra warning chrome for being the competition. The only visual signal is
 * position in the field, computed from the data, and it marks Monad as worst
 * whenever Monad is worst.
 *
 * That restraint is the point. A page that styles the conclusion is read as an
 * advertisement, and then every number on it gets discounted, including the true
 * ones.
 */

export interface JourneyStepperProps {
  stages: StageContent[];
  /** Chain id to display name and accent colour. */
  chainMeta: Record<string, { name: string; shortName: string; accent: string }>;
  /** Compact mode drops the prose and the studio links, for the embed. */
  compact?: boolean;
}

const TONE_TEXT: Record<Tone, string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  neutral: 'text-text-primary',
  poor: 'text-orange-600 dark:text-orange-400',
};

function StageNav({
  stages,
  active,
  onSelect,
}: {
  stages: StageContent[];
  active: number;
  onSelect: (index: number) => void;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2" role="tablist" aria-label="Development journey">
      {stages.map((stage, index) => {
        const isActive = index === active;
        return (
          <li key={stage.id} className="flex items-center">
            <button
              role="tab"
              aria-selected={isActive}
              aria-controls={`stage-panel-${stage.id}`}
              id={`stage-tab-${stage.id}`}
              onClick={() => onSelect(index)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                isActive
                  ? 'border-accent-line bg-accent-soft text-text-primary'
                  : 'border-transparent text-text-muted hover:border-border-subtle hover:text-text-primary'
              }`}
            >
              <span
                className={`grid h-4 w-4 place-items-center rounded-full text-[10px] font-semibold tabular-nums ${
                  isActive ? 'bg-accent text-white' : 'bg-border-subtle text-text-muted'
                }`}
              >
                {index + 1}
              </span>
              {stage.label}
            </button>
            {index < stages.length - 1 && (
              <span aria-hidden className="mx-0.5 h-px w-3 bg-border-subtle sm:w-4" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function JourneyStepper({ stages, chainMeta, compact = false }: JourneyStepperProps) {
  const [active, setActive] = useState(0);
  const stage = stages[active];
  if (stage === undefined) return null;

  const meta = (id: string) => chainMeta[id] ?? { name: id, shortName: id, accent: '#888' };

  return (
    <div>
      <StageNav stages={stages} active={active} onSelect={setActive} />

      <div
        role="tabpanel"
        id={`stage-panel-${stage.id}`}
        aria-labelledby={`stage-tab-${stage.id}`}
        className="mt-6"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h3 className="font-display text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">
            {stage.question}
          </h3>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            {stage.metric}
          </span>
        </div>

        {!compact && (
          <p className="mt-3 max-w-3xl text-[14.5px] leading-relaxed text-text-secondary">
            {stage.whatChanges}
          </p>
        )}

        <ul className="mt-6 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(184px, 1fr))' }}>
          {stage.values.map((value) => {
            const chain = meta(value.chain);
            return (
              <li
                key={value.chain}
                className="rounded-xl border border-border-subtle px-3.5 py-3"
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: chain.accent }}
                  />
                  <span className="truncate text-[12px] font-medium text-text-primary">
                    {chain.shortName}
                  </span>
                </span>
                <span
                  className={`mt-2 block font-mono text-[15px] tabular-nums ${TONE_TEXT[value.tone]}`}
                >
                  {value.value}
                </span>
                {!compact && (
                  <span className="mt-1.5 block text-[11.5px] leading-relaxed text-text-muted">
                    {value.detail}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {stage.friction.length > 0 && (
          <div className="mt-6">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              What it costs you here
            </h4>
            <ul className="mt-2.5 space-y-2">
              {stage.friction.map((item, index) => {
                const chain = meta(item.chain);
                return (
                  <li
                    key={`${item.chain}-${index}`}
                    className="flex items-start gap-2.5 text-[13px] leading-relaxed text-text-secondary"
                  >
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: chain.accent }}
                    />
                    <span>
                      <span className="font-medium text-text-primary">{chain.shortName}</span>{' '}
                      {item.note}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-4">
          {!compact && stage.studio !== null && (
            <Link
              href={`/studio?sample=${stage.studio.sample}`}
              className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              {stage.studio.label}
            </Link>
          )}
          <a
            href={stage.source}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] text-accent hover:underline"
          >
            Source
          </a>
          {!compact && (
            <span className="text-[12px] text-text-muted">
              Stage {active + 1} of {stages.length}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
