'use client';

import React, { useSyncExternalStore } from 'react';
import { ArrowUpRight, Boxes, Github, Sparkles } from 'lucide-react';

/**
 * What the studio shows when there is nothing open.
 *
 * A first visit used to present roughly thirty seven competing controls and no
 * entry point, so the honest question a new user had was not "which button" but
 * "what is this for". These three cards answer that by naming the three states
 * a person actually arrives in: they have a repository, they have something
 * already deployed, or they have neither.
 *
 * This is the permanent empty state, not a dismissable tour. That distinction
 * drives the whole design: every card is a live launcher rather than a step, it
 * has to survive being seen a hundred times, and it has to look like part of
 * the product rather than an overlay bolted on top of it.
 *
 * The palette hint sits underneath rather than inside a card, because it is the
 * answer to a question nobody has yet on their first visit and the answer they
 * need on their tenth.
 */

export interface StartCardsProps {
    /** Pick a repository from a connected account. Not called while disconnected. */
    onPickRepo: () => void;
    onPickAddress: () => void;
    onPickTemplate: () => void;
    githubConnected: boolean;
    /** Where the GitHub App install flow starts. Absent means the install is
     *  not configured, so the card falls back to asking for a pasted link. */
    connectUrl?: string;
}

const CARD_CLASS =
    'group relative flex h-full flex-col items-start gap-3 rounded-2xl border border-border-subtle bg-surface-base p-5 text-left transition-[transform,box-shadow,border-color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-panel)] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0';

/**
 * Which modifier key to print in the palette hint.
 *
 * The platform is only knowable on the client, so this is read through
 * useSyncExternalStore rather than corrected from an effect: the server
 * snapshot is what renders during hydration and the client snapshot replaces
 * it in the same commit, with no mismatch and no second paint of the wrong key.
 * The platform never changes mid-session, so there is nothing to subscribe to.
 */
const subscribeToPlatform = () => () => {};
const readModifier = () => (/mac/i.test(navigator.userAgent) ? '⌘' : 'Ctrl ');
const serverModifier = () => '⌘';

interface CardBody {
    icon: React.ReactNode;
    title: string;
    blurb: string;
    action: string;
}

function CardContent({ icon, title, blurb, action }: CardBody) {
    return (
        <>
            <span
                aria-hidden
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-border-subtle bg-surface-sunken text-text-secondary transition-colors duration-200 group-hover:border-accent-line group-hover:bg-accent-soft group-hover:text-accent"
            >
                {icon}
            </span>

            <span className="font-display text-[15px] font-semibold tracking-[-0.01em] text-text-primary">
                {title}
            </span>

            <span className="text-[12.5px] leading-relaxed text-text-secondary">{blurb}</span>

            <span className="mt-auto flex items-center gap-1.5 pt-3 text-[12.5px] font-medium text-accent">
                {action}
                <ArrowUpRight
                    size={13}
                    aria-hidden
                    className="transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0 motion-reduce:group-hover:translate-y-0"
                />
            </span>
        </>
    );
}

export function StartCards({
    onPickRepo,
    onPickAddress,
    onPickTemplate,
    githubConnected,
    connectUrl,
}: StartCardsProps) {
    const modifier = useSyncExternalStore(subscribeToPlatform, readModifier, serverModifier);

    const needsInstall = !githubConnected && connectUrl !== undefined;

    const repoCard: CardBody = {
        icon: <Github size={17} />,
        title: 'I have a repo',
        blurb:
            'Point us at a GitHub repository and every contract in it gets the full report: security, gas, parallel execution and chain fit.',
        action: githubConnected ? 'Pick a repository' : 'Connect GitHub',
    };

    return (
        <section aria-labelledby="start-heading" className="mx-auto w-full max-w-4xl px-6 py-12">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                Start here
            </p>
            <h2
                id="start-heading"
                className="mt-2 font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] text-text-primary"
            >
                Bring a contract in, get the whole report back.
            </h2>
            <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-text-secondary">
                One pass covers security findings, gas per function, how well it parallelises on
                Monad, and what it would cost on other chains.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {needsInstall ? (
                    <a href={connectUrl} className={CARD_CLASS}>
                        <CardContent {...repoCard} />
                    </a>
                ) : (
                    <button type="button" onClick={onPickRepo} className={CARD_CLASS}>
                        <CardContent {...repoCard} />
                    </button>
                )}

                <button type="button" onClick={onPickAddress} className={CARD_CLASS}>
                    <CardContent
                        icon={<Boxes size={17} />}
                        title="I have a deployed contract"
                        blurb="Paste an address. We pull the verified source, audit it, and price the same calls on Monad against the chain it lives on today."
                        action="Paste an address"
                    />
                </button>

                <button type="button" onClick={onPickTemplate} className={CARD_CLASS}>
                    <CardContent
                        icon={<Sparkles size={17} />}
                        title="I am starting fresh"
                        blurb="Open a template that already compiles, or describe what you want built and let the assistant write the first version."
                        action="Pick a template"
                    />
                </button>
            </div>

            <p className="mt-6 text-[12px] text-text-muted">
                Press{' '}
                <kbd className="rounded border border-border-subtle bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-text-secondary">
                    {modifier}K
                </kbd>{' '}
                for everything else.
            </p>
        </section>
    );
}
