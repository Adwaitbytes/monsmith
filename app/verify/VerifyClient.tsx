'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { keccak256, toBytes, isAddress } from 'viem';
import { ArrowRight, BadgeCheck, Check, Copy, FileCode2, Loader2, SearchX, ShieldCheck } from 'lucide-react';

import { LedgerFeed } from './LedgerFeed';

/**
 * Verify a contract against Monsmith's onchain record.
 *
 * Everything shown here comes from the attestations contract on Monad
 * mainnet, through /api/verify. The source option hashes the code in the
 * browser, so the code itself is never sent anywhere; only its hash is.
 */

const CHAINS = [
    { id: 143, key: 'monad-mainnet', label: 'Monad' },
    { id: 1, key: 'ethereum', label: 'Ethereum' },
    { id: 10143, key: 'monad-testnet', label: 'Monad testnet' },
    { id: 11155111, key: 'sepolia', label: 'Sepolia' },
] as const;

interface Verdict {
    attested: boolean;
    agent: { agentId: string; registry: string };
    contract: string;
    contractUrl?: string;
    attestation?: {
        sourceHash: string;
        score: number;
        critical: number;
        high: number;
        medium: number;
        low: number;
        attestedAt: string;
        reportHash: string;
        reportURI: string;
    };
    reportMatches?: boolean | null;
    /** The implementation the answer is about, when the address asked about is a proxy. */
    proxyOf?: string;
    error?: string;
}

function grade(score: number): string {
    if (score >= 90) return 'A';
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    if (score >= 40) return 'D';
    return 'F';
}

const TAB = 'rounded-lg px-3 py-1.5 text-[13px] font-medium outline-none ring-accent-line transition-colors focus-visible:ring-2';

export function VerifyClient() {
    const [mode, setMode] = useState<'address' | 'source'>('address');
    const [address, setAddress] = useState('');
    const [chainId, setChainId] = useState<number>(143);
    const [source, setSource] = useState('');
    const [busy, setBusy] = useState(false);
    const [verdict, setVerdict] = useState<Verdict | null>(null);
    const [asked, setAsked] = useState<{ chainKey: string; address: string } | null>(null);
    const [copied, setCopied] = useState(false);

    const check = async (event: React.FormEvent) => {
        event.preventDefault();
        setVerdict(null);
        let query: string;
        if (mode === 'address') {
            if (!isAddress(address.trim())) {
                setVerdict({ attested: false, agent: { agentId: '', registry: '' }, contract: '', error: 'That is not a valid contract address.' });
                return;
            }
            query = `chainId=${chainId}&address=${address.trim()}`;
            setAsked({ chainKey: CHAINS.find((chain) => chain.id === chainId)?.key ?? 'monad-mainnet', address: address.trim() });
        } else {
            if (source.trim().length === 0) return;
            query = `source=${keccak256(toBytes(source))}`;
            setAsked(null);
        }
        setBusy(true);
        try {
            const response = await fetch(`/api/verify?${query}`);
            setVerdict((await response.json()) as Verdict);
        } catch {
            setVerdict({ attested: false, agent: { agentId: '', registry: '' }, contract: '', error: 'Could not reach the verifier.' });
        } finally {
            setBusy(false);
        }
    };

    const curl = 'curl "https://www.monsmith.com/api/verify?chainId=143&address=0x..."';
    const attestation = verdict?.attestation;

    return (
        <main className="mx-auto max-w-2xl px-6 py-14 sm:py-20">
            <p className="inline-flex items-center gap-1.5 rounded-full border border-accent-line bg-accent-soft px-2.5 py-1 text-[11.5px] font-medium text-accent">
                <ShieldCheck size={12} aria-hidden />
                Onchain on Monad
            </p>
            <h1 className="mt-5 text-balance font-display text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[42px]">
                Check a contract before you trust it.
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-text-secondary">
                Every audit Monsmith publishes is attested on Monad mainnet under its ERC-8004 agent identity. Look one up by
                deployed address or by source code. The answer comes from the chain, not from this site.
            </p>

            <form onSubmit={(event) => void check(event)} className="mt-8 rounded-2xl border border-border-subtle bg-surface-raised p-4 shadow-[var(--shadow-panel)]">
                <div role="tablist" aria-label="Look up by" className="mb-3 flex gap-1">
                    {(['address', 'source'] as const).map((value) => (
                        <button
                            key={value}
                            type="button"
                            role="tab"
                            aria-selected={mode === value}
                            onClick={() => setMode(value)}
                            className={`${TAB} ${mode === value ? 'bg-accent-soft text-accent' : 'text-text-secondary hover:text-text-primary'}`}
                        >
                            {value === 'address' ? 'Deployed contract' : 'Source code'}
                        </button>
                    ))}
                </div>

                {mode === 'address' ? (
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <select
                            value={chainId}
                            onChange={(event) => setChainId(Number(event.target.value))}
                            aria-label="Chain"
                            className="rounded-lg border border-border-subtle bg-surface-sunken px-3 py-2.5 text-[13.5px] outline-none ring-accent-line focus-visible:ring-2"
                        >
                            {CHAINS.map((chain) => (
                                <option key={chain.id} value={chain.id}>
                                    {chain.label}
                                </option>
                            ))}
                        </select>
                        <input
                            value={address}
                            onChange={(event) => setAddress(event.target.value)}
                            placeholder="0x contract address"
                            aria-label="Contract address"
                            spellCheck={false}
                            className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface-sunken px-3 py-2.5 font-mono text-[13px] outline-none ring-accent-line placeholder:text-text-muted focus-visible:ring-2"
                        />
                    </div>
                ) : (
                    <textarea
                        value={source}
                        onChange={(event) => setSource(event.target.value)}
                        placeholder="Paste the Solidity file exactly as it was audited"
                        aria-label="Contract source"
                        rows={6}
                        spellCheck={false}
                        className="w-full resize-y rounded-lg border border-border-subtle bg-surface-sunken px-3 py-2.5 font-mono text-[12.5px] outline-none ring-accent-line placeholder:text-text-muted focus-visible:ring-2"
                    />
                )}

                <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-[12px] text-text-muted">
                        {mode === 'source' ? 'Hashed in your browser. The code is not sent.' : 'Looks up the latest attestation for this address.'}
                    </p>
                    <button
                        type="submit"
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white outline-none ring-accent-line ring-offset-2 ring-offset-surface-raised transition-opacity hover:opacity-90 focus-visible:ring-2 disabled:opacity-70"
                    >
                        {busy ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <ShieldCheck size={14} aria-hidden />}
                        Verify
                    </button>
                </div>
            </form>

            <div aria-live="polite">
                {verdict?.error !== undefined && (
                    <p className="mt-6 rounded-xl border border-red-500/30 bg-red-500/[0.08] px-4 py-3 text-[13px] text-text-secondary">{verdict.error}</p>
                )}

                {verdict !== null && verdict.error === undefined && !verdict.attested && (
                    <section className="mt-6 flex items-start gap-3 rounded-2xl border border-border-subtle bg-surface-raised p-5">
                        <SearchX size={18} className="mt-0.5 shrink-0 text-text-muted" aria-hidden />
                        <div>
                            <h2 className="text-[15px] font-semibold">No Monsmith audit on record</h2>
                            <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
                                Nothing has been attested for this {mode === 'address' ? 'contract' : 'source'} yet. That is not a verdict either way.
                            </p>
                            {asked !== null && (
                                <Link
                                    href={`/studio?address=${asked.address}&chain=${asked.chainKey}`}
                                    className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
                                >
                                    Audit it now
                                    <ArrowRight size={13} aria-hidden />
                                </Link>
                            )}
                        </div>
                    </section>
                )}

                {attestation !== undefined && verdict !== null && (
                    <section className="mt-6 overflow-hidden rounded-2xl border border-border-subtle bg-surface-raised shadow-[var(--shadow-panel)]">
                        <div className="flex flex-wrap items-center gap-5 p-5">
                            <div className="flex items-baseline gap-2">
                                <span className="font-display text-[52px] font-semibold leading-none tabular-nums">{attestation.score}</span>
                                <span className="rounded-md border border-border-subtle px-1.5 py-0.5 text-[12px] font-semibold">{grade(attestation.score)}</span>
                            </div>
                            <dl className="grid flex-1 grid-cols-4 gap-3 text-center">
                                {(
                                    [
                                        ['Critical', attestation.critical],
                                        ['High', attestation.high],
                                        ['Medium', attestation.medium],
                                        ['Low', attestation.low],
                                    ] as const
                                ).map(([label, value]) => (
                                    <div key={label}>
                                        <dd className="font-mono text-[18px] font-semibold tabular-nums">{value}</dd>
                                        <dt className="text-[11px] uppercase tracking-[0.1em] text-text-muted">{label}</dt>
                                    </div>
                                ))}
                            </dl>
                        </div>
                        <ul className="space-y-2 border-t border-border-subtle px-5 py-4 text-[13px]">
                            <li className="flex items-center gap-2 text-text-secondary">
                                <BadgeCheck size={14} className="shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                                Attested by Monsmith, ERC-8004 agent #{verdict.agent.agentId}, on {new Date(attestation.attestedAt).toUTCString()}
                            </li>
                            {verdict.proxyOf !== undefined && (
                                <li className="flex items-start gap-2 text-text-secondary">
                                    <ArrowRight size={14} className="mt-0.5 shrink-0 text-text-muted" aria-hidden />
                                    <span>
                                        This address is a proxy. The audit is of the code it points at now,{' '}
                                        <span className="font-mono text-[12px]">{verdict.proxyOf}</span>. Its owner can change that.
                                    </span>
                                </li>
                            )}
                            {verdict.reportMatches === true && (
                                <li className="flex items-center gap-2 text-text-secondary">
                                    <Check size={14} className="shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                                    The report is unchanged since it was published: its hash matches the chain.
                                </li>
                            )}
                            {verdict.reportMatches === false && (
                                <li className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                                    The stored report no longer matches the hash on chain. Trust the onchain score.
                                </li>
                            )}
                        </ul>
                        <div className="flex flex-wrap gap-3 border-t border-border-subtle bg-surface-sunken px-5 py-3.5">
                            <a href={attestation.reportURI} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
                                <FileCode2 size={13} aria-hidden />
                                Read the full report
                            </a>
                            {verdict.contractUrl !== undefined && (
                                <a href={verdict.contractUrl} target="_blank" rel="noopener" className="text-[13px] text-text-secondary hover:text-text-primary hover:underline">
                                    Attestations contract on MonadVision
                                </a>
                            )}
                        </div>
                    </section>
                )}
            </div>

            <LedgerFeed />

            <section className="mt-12 rounded-2xl border border-border-subtle bg-surface-sunken p-5">
                <h2 className="text-[14px] font-semibold">For agents and wallets</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
                    The same check is one request. An agent can call it before it signs a transaction to an unfamiliar contract.
                </p>
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-border-subtle bg-background px-3 py-2">
                    <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-secondary">{curl}</code>
                    <button
                        type="button"
                        aria-label="Copy the command"
                        onClick={() => {
                            void navigator.clipboard.writeText(curl).then(() => {
                                setCopied(true);
                                setTimeout(() => setCopied(false), 1500);
                            });
                        }}
                        className="rounded p-1 text-text-muted outline-none ring-accent-line hover:text-text-primary focus-visible:ring-2"
                    >
                        {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
                    </button>
                </div>
                <p className="mt-2 text-[12px] text-text-muted">
                    Agent registration: <a href="/agent.json" className="underline">/agent.json</a>
                </p>
            </section>
        </main>
    );
}
