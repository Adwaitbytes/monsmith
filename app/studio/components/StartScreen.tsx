'use client';

import React, { useSyncExternalStore } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useAuthState } from '@/lib/auth/client';
import { ArrowRight, Boxes, Check, FilePlus2, Github, Loader2, Play } from 'lucide-react';

import { formatPrice, freeBundlePhrase, type Plan } from '@/lib/billing/offer';
import { REFERENCE_CONTRACTS, type ReferenceContract } from '../referenceContracts';
import { Omnibox, type OmniboxIntent } from './Omnibox';

/**
 * What the studio shows before there is anything to look at.
 *
 * The feedback that shaped this was blunt: too many options, no one-button path
 * with a sample, and no idea what to do. So the screen leads with contracts
 * every developer already knows, The DAO first, each one click from a full
 * report, and everything else is subordinate to that. Your own code goes in the
 * box under them;
 * the other ways in are text links, because they are answers to questions a
 * first visitor does not have yet.
 *
 * The offer is on this screen rather than discovered at the paywall. Being told
 * the price after the work is done reads as a trap; being told before, with the
 * free part first, reads as a product.
 */

export interface StartScreenProps {
    onPickReference: (reference: ReferenceContract) => void;
    /** The reference contract being fetched, while it is. */
    loadingReference: string | null;
    referenceError: string | null;
    onSubmit: (intent: OmniboxIntent) => void;
    importing: boolean;
    onPickRepo: () => void;
    onPickAddress: () => void;
    onPickTemplate: () => void;
    onShowTour: () => void;
    githubConnected: boolean;
    /** Where the GitHub App install starts; absent when it is not configured. */
    connectUrl?: string;
    plan: Plan | null;
}

const subscribeToPlatform = () => () => {};
const readModifier = () => (/mac/i.test(navigator.userAgent) ? '⌘' : 'Ctrl ');
const serverModifier = () => '⌘';

const INCLUDED = [
    'Every finding with its exact line and a fix',
    'Gas cost for each function',
    'How well it runs in parallel on Monad',
    'What the same calls cost on other chains',
    'Patches you can apply in one click',
    'One-click optimization that fixes the findings and proves it with a new score',
] as const;

const EASE = [0.16, 1, 0.3, 1] as const;

const LINK_CLASS =
    'inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[12.5px] text-text-secondary outline-none ring-accent-line transition-colors hover:text-text-primary focus-visible:ring-2';

function Offer({ plan }: { plan: Plan }) {
    const { isSignedIn, openSignIn } = useAuthState();
    const price = plan.price === null ? null : formatPrice(plan.price);
    const free = plan.freeReports;
    const bundle = freeBundlePhrase(plan);

    const heading = !plan.paywall
        ? 'Every report is free while Monsmith is in beta'
        : bundle !== null
          ? `Your first ${bundle} are free`
          : 'Pay only for the reports you want';

    return (
        <section
            aria-labelledby="offer-heading"
            className="overflow-hidden rounded-2xl border border-border-subtle bg-surface-raised shadow-[var(--shadow-panel)]"
        >
            <div className="grid gap-6 p-6 sm:grid-cols-[auto_1fr] sm:gap-8">
                {plan.paywall && (free > 0 || plan.freeOptimizations > 0) && (
                    <div className="flex gap-6 sm:flex-col sm:gap-4">
                        {free > 0 && (
                            <div>
                                <span className="block font-display text-[48px] font-semibold leading-none tracking-[-0.04em] text-accent">
                                    {free}
                                </span>
                                <span className="text-[11.5px] font-medium uppercase tracking-[0.12em] text-text-muted">
                                    free {free === 1 ? 'report' : 'reports'}
                                </span>
                            </div>
                        )}
                        {plan.freeOptimizations > 0 && (
                            <div>
                                <span className="block font-display text-[48px] font-semibold leading-none tracking-[-0.04em] text-accent">
                                    {plan.freeOptimizations}
                                </span>
                                <span className="text-[11.5px] font-medium uppercase tracking-[0.12em] text-text-muted">
                                    free {plan.freeOptimizations === 1 ? 'optimization' : 'optimizations'}
                                </span>
                            </div>
                        )}
                    </div>
                )}

                <div className="min-w-0">
                    <h2
                        id="offer-heading"
                        className="font-display text-[17px] font-semibold tracking-[-0.01em] text-text-primary"
                    >
                        {heading}
                    </h2>
                    <p className="mt-1 text-[13px] text-text-secondary">
                        {plan.paywall && free > 0
                            ? 'Complete, with nothing held back. Each one includes:'
                            : 'Each report includes:'}
                    </p>

                    <ul className="mt-3.5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                        {INCLUDED.map((item) => (
                            <li key={item} className="flex items-start gap-2 text-[13px] text-text-primary">
                                <Check
                                    size={14}
                                    strokeWidth={2.5}
                                    aria-hidden
                                    className="mt-[3px] shrink-0 text-emerald-600 dark:text-emerald-400"
                                />
                                {item}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            {plan.paywall && (
                <div className="flex flex-col gap-3 border-t border-border-subtle bg-surface-sunken px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[12.5px] leading-relaxed text-text-secondary">
                        {free > 0 && !isSignedIn && 'Sign in to use them. '}
                        {price !== null && (
                            <>
                                After that, <span className="font-medium text-text-primary">{price} per report</span>,
                                optimization included, paid by card.{' '}
                            </>
                        )}
                        Every report shows its score, severity counts and finding titles for free.
                    </p>
                    {free > 0 && isSignedIn === false && (
                            <button
                                type="button"
                                onClick={openSignIn}
                                className="shrink-0 rounded-lg border border-border-strong bg-surface-raised px-3.5 py-2 text-[12.5px] font-medium text-text-primary outline-none ring-accent-line transition-colors hover:border-accent-line hover:text-accent focus-visible:ring-2"
                            >
                                Sign in free
                            </button>
                    )}
                </div>
            )}
        </section>
    );
}

/** The offer in one row, beside the button, so it is read before anything is run. */
function OfferLine({ plan }: { plan: Plan }) {
    const points: string[] = [];
    if (!plan.paywall) points.push('Free while in beta');
    else {
        if (plan.freeReports > 0) points.push(`${plan.freeReports} full ${plan.freeReports === 1 ? 'report' : 'reports'} free`);
        if (plan.freeOptimizations > 0) {
            points.push(`${plan.freeOptimizations} ${plan.freeOptimizations === 1 ? 'optimization' : 'optimizations'} free`);
        }
        if (plan.price !== null) points.push(`then ${formatPrice(plan.price)} per report`);
        points.push('no subscription');
    }
    return (
        <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
            {points.map((point) => (
                <li key={point} className="flex items-center gap-1.5 text-[12.5px] text-text-secondary">
                    <Check size={13} strokeWidth={2.5} aria-hidden className="text-emerald-600 dark:text-emerald-400" />
                    {point}
                </li>
            ))}
        </ul>
    );
}

const TILE_CLASS =
    'group flex h-full flex-col items-start rounded-xl border border-border-subtle bg-surface-raised p-3.5 text-left outline-none ring-accent-line transition-[transform,border-color,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-panel)] focus-visible:ring-2 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none motion-reduce:hover:translate-y-0';

/**
 * The famous contracts, with the first one as the focal button.
 *
 * One of them leads so the screen still has a single obvious action; the rest
 * sit under it as equals for the visitor who would rather see a contract they
 * know better. Everything is disabled while one loads, since two runs at once
 * would race for the report rail.
 */
function ReferencePicker({
    onPick,
    loading,
}: {
    onPick: (reference: ReferenceContract) => void;
    loading: string | null;
}) {
    const [featured, ...rest] = REFERENCE_CONTRACTS;
    const busy = loading !== null;

    return (
        <div className="space-y-2.5">
            <button
                type="button"
                onClick={() => onPick(featured)}
                disabled={busy}
                className="group flex w-full items-center gap-4 rounded-2xl bg-accent px-5 py-4 text-left text-white shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_10px_28px_-10px_rgba(109,40,217,0.55)] outline-none ring-accent-line ring-offset-2 ring-offset-background transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 focus-visible:ring-2 active:translate-y-0 disabled:cursor-wait disabled:opacity-80 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15">
                    {loading === featured.id ? (
                        <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden />
                    ) : (
                        <Play size={18} fill="currentColor" aria-hidden />
                    )}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold">
                        {loading === featured.id ? `Loading ${featured.name}` : `Check ${featured.name}`}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] text-white/75">{featured.pitch ?? featured.blurb}</span>
                </span>
                <ArrowRight
                    size={18}
                    aria-hidden
                    className="shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
                />
            </button>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {rest.map((reference) => (
                    <button
                        key={reference.id}
                        type="button"
                        onClick={() => onPick(reference)}
                        disabled={busy}
                        title={reference.blurb}
                        className={TILE_CLASS}
                    >
                        <span className="flex w-full items-center justify-between gap-2">
                            <span className="text-[13px] font-semibold leading-tight text-text-primary">
                                {reference.name}
                            </span>
                            {loading === reference.id ? (
                                <Loader2
                                    size={13}
                                    aria-hidden
                                    className="shrink-0 animate-spin text-accent motion-reduce:animate-none"
                                />
                            ) : (
                                <ArrowRight
                                    size={13}
                                    aria-hidden
                                    className="shrink-0 text-text-muted transition-[transform,color] duration-200 group-hover:translate-x-0.5 group-hover:text-accent motion-reduce:transition-none"
                                />
                            )}
                        </span>
                        <span className="mt-1 font-mono text-[10.5px] text-text-muted">
                            {reference.year} · solc {reference.compiler}
                        </span>
                        <span className="mt-2 text-[11.5px] leading-snug text-text-secondary">
                            {reference.blurb}
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
}

export function StartScreen({
    onPickReference,
    loadingReference,
    referenceError,
    onSubmit,
    importing,
    onPickRepo,
    onPickAddress,
    onPickTemplate,
    onShowTour,
    githubConnected,
    connectUrl,
    plan,
}: StartScreenProps) {
    const reduce = useReducedMotion();
    const modifier = useSyncExternalStore(subscribeToPlatform, readModifier, serverModifier);
    const needsInstall = !githubConnected && connectUrl !== undefined;

    const rise = (delay: number) => ({
        initial: reduce ? false : { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.4, delay: reduce ? 0 : delay, ease: EASE },
    });

    return (
        <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-2xl flex-col px-6 pb-16 pt-14 sm:pt-20">
                <motion.p
                    {...rise(0)}
                    className="self-start rounded-full border border-accent-line bg-accent-soft px-2.5 py-1 text-[11.5px] font-medium text-accent"
                >
                    Smart contract audits for Monad
                </motion.p>

                <motion.h1
                    {...rise(0.04)}
                    className="mt-5 text-balance font-display text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] text-text-primary sm:text-[44px]"
                >
                    Find the bugs before your users do.
                </motion.h1>

                <motion.p
                    {...rise(0.08)}
                    className="mt-4 max-w-xl text-pretty text-[15px] leading-relaxed text-text-secondary"
                >
                    One report shows the security issues with the exact line and fix, the gas each function costs,
                    and how well your contract runs in parallel on Monad. It takes about a minute.
                </motion.p>

                <motion.div {...rise(0.12)} className="mt-8">
                    <p className="mb-2.5 text-[12px] font-medium text-text-muted">
                        Try it on a contract every developer knows
                    </p>
                    <ReferencePicker
                        onPick={onPickReference}
                        loading={loadingReference}
                    />
                    {referenceError !== null && (
                        <p role="alert" className="mt-2.5 text-[12.5px] text-red-600 dark:text-red-400">
                            {referenceError}
                        </p>
                    )}
                    {plan !== null && <OfferLine plan={plan} />}
                </motion.div>

                <motion.div {...rise(0.16)} className="mt-8">
                    <p className="mb-2.5 text-[12px] font-medium text-text-muted">Or check your own contract</p>
                    <Omnibox onSubmit={onSubmit} busy={importing} />
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                        {needsInstall ? (
                            <a href={connectUrl} className={LINK_CLASS}>
                                <Github size={13} aria-hidden />
                                Pick from GitHub
                            </a>
                        ) : (
                            <button type="button" onClick={onPickRepo} className={LINK_CLASS}>
                                <Github size={13} aria-hidden />
                                Pick from GitHub
                            </button>
                        )}
                        <button type="button" onClick={onPickAddress} className={LINK_CLASS}>
                            <Boxes size={13} aria-hidden />
                            Deployed address
                        </button>
                        <button type="button" onClick={onPickTemplate} className={LINK_CLASS}>
                            <FilePlus2 size={13} aria-hidden />
                            Start from a template
                        </button>
                    </div>
                </motion.div>

                {plan !== null && (
                    <motion.div {...rise(0.2)} className="mt-12">
                        <Offer plan={plan} />
                    </motion.div>
                )}

                <p className="mt-8 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-text-muted">
                    <span>Already know your way around? Press</span>
                    <kbd className="rounded border border-border-subtle bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-text-secondary">
                        {modifier}K
                    </kbd>
                    <span>for everything.</span>
                    <span aria-hidden>·</span>
                    <button
                        type="button"
                        onClick={onShowTour}
                        className="rounded text-text-secondary underline decoration-border-strong underline-offset-4 outline-none ring-accent-line transition-colors hover:text-text-primary hover:decoration-accent focus-visible:ring-2"
                    >
                        Take the tour
                    </button>
                </p>
            </div>
        </div>
    );
}
