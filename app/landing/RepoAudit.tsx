'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Github, Loader2 } from 'lucide-react';

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

const EXAMPLES: ReadonlyArray<{ label: string; url: string }> = [
    { label: 'solmate', url: 'https://github.com/transmissions11/solmate/tree/main/src/tokens' },
    { label: 'OpenZeppelin', url: 'https://github.com/OpenZeppelin/openzeppelin-contracts/tree/master/contracts/finance' },
];

export function RepoAudit() {
    const router = useRouter();
    const [value, setValue] = useState('');
    const [handing, setHanding] = useState(false);

    const parsed = useMemo(() => (value.trim() === '' ? null : parseRepoInput(value)), [value]);
    const ready = parsed !== null;

    const go = (url: string) => {
        setHanding(true);
        track('page_view', { detail: { event: 'cta_click', cta: 'hero_repo_audit' } });
        router.push(`/studio?repo=${encodeURIComponent(url)}`);
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
                    <Github size={17} aria-hidden className="shrink-0 text-text-muted" />
                    <input
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        placeholder="Paste a GitHub repo"
                        aria-label="GitHub repository to audit"
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        className="min-w-0 flex-1 bg-transparent py-2 text-[15px] text-text-primary outline-none placeholder:text-text-muted"
                    />
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
                    <React.Fragment key={example.url}>
                        {index > 0 && <span aria-hidden>or</span>}
                        <button
                            type="button"
                            onClick={() => go(example.url)}
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
                    That does not look like a repository. A link from your browser bar works, so
                    does owner/name.
                </p>
            )}
        </div>
    );
}
