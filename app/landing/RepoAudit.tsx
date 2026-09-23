'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Box, Github, Loader2 } from 'lucide-react';

import { parseRepoInput } from '@/lib/github/source';
import { track } from '@/lib/track';

/**
 * Paste a repository, get an audit. On the front page, above the fold.
 *
 * Every other route into this product asks a visitor to commit first: open the
 * studio, work out which panel they want, then find something to measure. This
 * asks for the one thing a developer already has in their clipboard, and the
 * next thing they see is their own contracts being measured rather than a
 * sample of ours.
 *
 * It needs no account and no GitHub connection. A public repository resolves
 * unauthenticated, which is what lets this sit on a marketing page at all: the
 * demo is the product, run against their code, with nothing to sign up for.
 *
 * The work happens in the studio rather than here. This hands off through the
 * `repo` parameter the studio already understands, so there is one import path
 * and one place where a failure has to be explained.
 */

const EXAMPLES: ReadonlyArray<{ label: string; value: string }> = [
    { label: 'solmate', value: 'https://github.com/transmissions11/solmate/tree/main/src/tokens' },
    { label: 'OpenZeppelin', value: 'https://github.com/OpenZeppelin/openzeppelin-contracts/tree/master/contracts/finance' },
    // A real deployed contract, so the address half of the offer is not just a
    // claim in a placeholder that nobody has anything to test it with.
    { label: 'DAI on Ethereum', value: '0x6B175474E89094C44Da98b954EedeAC495271d0F' },
];

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

/**
 * What the field thinks you have given it.
 *
 * Shown back as you type rather than explained up front. A placeholder long
 * enough to list both kinds of input is a placeholder that truncates on a phone,
 * and one that rotates through examples is movement where the eye is trying to
 * read. Answering as soon as there is something to answer about teaches the
 * same thing without asking for any attention before it is earned.
 */
type Intent = 'repo' | 'address' | 'unknown';

function intentOf(value: string): Intent {
    const text = value.trim();
    if (text.length === 0) return 'unknown';
    if (ADDRESS.test(text)) return 'address';
    return parseRepoInput(text) !== null ? 'repo' : 'unknown';
}

export function RepoAudit() {
    const router = useRouter();
    const [value, setValue] = useState('');
    const [handing, setHanding] = useState(false);

    const intent = useMemo(() => intentOf(value), [value]);
    const ready = intent !== 'unknown';

    const go = (raw: string) => {
        const text = raw.trim();
        setHanding(true);
        track('page_view', {
            detail: { event: 'cta_click', cta: 'hero_audit', kind: intentOf(text) },
        });

        // Two doors into the same room. The studio already knows how to take
        // either, so the hero decides which parameter to hand over and nothing
        // downstream needs to care where the contract came from.
        router.push(
            ADDRESS.test(text)
                ? `/studio?address=${encodeURIComponent(text)}`
                : `/studio?repo=${encodeURIComponent(text)}`,
        );
    };

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        if (!ready || handing) return;
        go(value.trim());
    };

    return (
        <div className="w-full max-w-xl">
            <form onSubmit={submit}>
                <div className="flex items-center gap-2 rounded-2xl border border-border-strong bg-surface-base/80 p-2 pl-4 backdrop-blur-sm transition-colors focus-within:border-accent-line">
                    {/* The icon answers before the chip does, and costs no space. */}
                    {intent === 'address' ? (
                        <Box size={17} aria-hidden className="shrink-0 text-accent" />
                    ) : (
                        <Github
                            size={17}
                            aria-hidden
                            className={`shrink-0 transition-colors ${intent === 'repo' ? 'text-accent' : 'text-text-muted'}`}
                        />
                    )}
                    <input
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        placeholder="Paste a GitHub repo or contract address"
                        aria-label="A GitHub repository or a deployed contract address to audit"
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        className="min-w-0 flex-1 bg-transparent py-2 text-[15px] text-text-primary outline-none placeholder:text-text-muted"
                    />
                    {/* Names what it found, once there is something to name. */}
                    {ready && (
                        <span className="hidden shrink-0 rounded-full border border-accent-line bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent sm:inline">
                            {intent === 'address' ? 'Deployed contract' : 'GitHub repo'}
                        </span>
                    )}

                    <button
                        type="submit"
                        disabled={!ready || handing}
                        className={`group inline-flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold outline-none ring-accent-line transition-all focus-visible:ring-2 ${
                            ready && !handing
                                ? 'bg-accent text-white hover:opacity-90'
                                : 'cursor-not-allowed bg-surface-overlay text-text-muted'
                        }`}
                    >
                        {handing ? (
                            <Loader2 size={15} className="animate-spin motion-reduce:animate-none" />
                        ) : (
                            <ArrowRight
                                size={15}
                                className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                            />
                        )}
                        Audit it
                    </button>
                </div>
            </form>

            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-text-muted">
                {/*
                  A visitor with nothing to paste is the common case on a
                  landing page, and a disabled button is a dead end. These are
                  real repositories, so the first thing they see is a real
                  measurement rather than a tour.
                */}
                <span>No account needed. Try</span>
                {EXAMPLES.map((example, index) => (
                    <React.Fragment key={example.value}>
                        {index > 0 && <span aria-hidden>or</span>}
                        <button
                            type="button"
                            onClick={() => go(example.value)}
                            className="rounded text-text-secondary underline decoration-border-strong underline-offset-4 outline-none ring-accent-line transition-colors hover:text-text-primary hover:decoration-accent focus-visible:ring-2"
                        >
                            {example.label}
                        </button>
                    </React.Fragment>
                ))}
                <span>.</span>
            </div>

            {value.trim() !== '' && !ready && (
                <p className="mt-2 text-[12.5px] text-text-muted">
                    That is not a repository or an address. A link from your browser bar works, so
                    does owner/name, or a 0x address of a verified contract.
                </p>
            )}
        </div>
    );
}
