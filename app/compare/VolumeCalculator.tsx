'use client';

import React, { useMemo, useState } from 'react';

/**
 * What the same app costs on each chain once it has users.
 *
 * A per-call figure of $0.0001 against $0.0007 reads as "both are free". The
 * same two numbers at fifty thousand transactions a day are $150 and $1,050 a
 * month, which is a hiring decision. Multiplying is the whole trick, and it is
 * the form the number needs to be in before anyone acts on it.
 */

export interface VolumeChain {
  id: string;
  shortName: string;
  accent: string;
  /** USD per gas unit, derived from the live probe. Null when unpriced. */
  usdPerGas: number | null;
  /** True where the gas limit rather than the gas used is what gets charged. */
  chargesGasLimit: boolean;
}

export interface VolumeCalculatorProps {
  chains: VolumeChain[];
  /** Gas for one representative user action. */
  defaultGas: number;
}

const VOLUME_STEPS = [1_000, 10_000, 50_000, 250_000, 1_000_000];
const DAYS_PER_MONTH = 30;
/** What a wallet typically pads an estimate by when nobody sets the limit. */
const PADDING = 1.5;

function money(value: number): string {
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1000) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function compactVolume(value: number): string {
  if (value >= 1_000_000) return `${value / 1_000_000}M`;
  if (value >= 1_000) return `${value / 1_000}k`;
  return String(value);
}

export function VolumeCalculator({ chains, defaultGas }: VolumeCalculatorProps) {
  const [volumeIndex, setVolumeIndex] = useState(2);
  const [gas, setGas] = useState(defaultGas);
  const [padded, setPadded] = useState(false);

  const perDay = VOLUME_STEPS[volumeIndex];

  const rows = useMemo(() => {
    const priced = chains
      .map((chain) => {
        if (chain.usdPerGas === null) return { chain, monthly: null };
        // Padding only costs money where the limit itself is charged.
        const effectiveGas = padded && chain.chargesGasLimit ? gas * PADDING : gas;
        return { chain, monthly: effectiveGas * chain.usdPerGas * perDay * DAYS_PER_MONTH };
      })
      .sort((a, b) => {
        if (a.monthly === null) return 1;
        if (b.monthly === null) return -1;
        return a.monthly - b.monthly;
      });

    const max = priced.reduce(
      (acc, row) => (row.monthly !== null && row.monthly > acc ? row.monthly : acc),
      0,
    );
    return { priced, max };
  }, [chains, gas, perDay, padded]);

  return (
    <div className="rounded-2xl border border-border-subtle p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <h3 className="font-display text-xl font-semibold tracking-tight text-text-primary">
            The same app, once it has users
          </h3>
          <p className="mt-1.5 max-w-lg text-[13.5px] leading-relaxed text-text-secondary">
            Gas fees per call at the live gas price, multiplied out to a monthly bill.
          </p>
        </div>

        <label className="flex items-center gap-2 text-[12.5px] text-text-secondary">
          <input
            type="checkbox"
            checked={padded}
            onChange={(event) => setPadded(event.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          Wallet pads the gas limit 1.5&times;
        </label>
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="flex items-baseline justify-between text-[12px] text-text-muted">
            Transactions per day
            <span className="font-mono tabular-nums text-text-primary">
              {perDay.toLocaleString('en-US')}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={VOLUME_STEPS.length - 1}
            step={1}
            value={volumeIndex}
            onChange={(event) => setVolumeIndex(Number(event.target.value))}
            className="mt-2 w-full accent-[var(--accent)]"
            aria-label="Transactions per day"
          />
          <span className="mt-1 flex justify-between text-[10px] text-text-muted">
            {VOLUME_STEPS.map((step) => (
              <span key={step}>{compactVolume(step)}</span>
            ))}
          </span>
        </label>

        <label className="block">
          <span className="flex items-baseline justify-between text-[12px] text-text-muted">
            Gas per transaction
            <span className="font-mono tabular-nums text-text-primary">
              {gas.toLocaleString('en-US')}
            </span>
          </span>
          <input
            type="range"
            min={21_000}
            max={500_000}
            step={1_000}
            value={gas}
            onChange={(event) => setGas(Number(event.target.value))}
            className="mt-2 w-full accent-[var(--accent)]"
            aria-label="Gas per transaction"
          />
          <span className="mt-1 flex justify-between text-[10px] text-text-muted">
            <span>21k transfer</span>
            <span>500k heavy call</span>
          </span>
        </label>
      </div>

      <ul className="mt-6 space-y-2">
        {rows.priced.map(({ chain, monthly }) => (
          <li key={chain.id} className="flex items-center gap-3">
            <span className="flex w-24 shrink-0 items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: chain.accent }}
              />
              <span className="truncate text-[12.5px] text-text-primary">{chain.shortName}</span>
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
              <span
                className="block h-full rounded-full transition-[width] duration-500 ease-out"
                style={{
                  width: monthly === null || rows.max === 0 ? '0%' : `${(monthly / rows.max) * 100}%`,
                  background: chain.accent,
                }}
              />
            </span>
            <span className="w-24 shrink-0 text-right font-mono text-[13px] tabular-nums text-text-primary">
              {monthly === null ? '-' : money(monthly)}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-[11.5px] leading-relaxed text-text-muted">
        Monthly, at {perDay.toLocaleString('en-US')} transactions a day. Execution gas only: the
        rollups additionally bill for posting calldata to Ethereum, so their real figures are
        higher than shown.
      </p>
    </div>
  );
}
