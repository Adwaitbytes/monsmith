'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Copy, LogOut, Wallet } from 'lucide-react';

import { useAuthState } from '@/lib/auth/client';
import type { Tier } from '@/lib/auth/roles';
import { TIER_LABELS } from '@/lib/auth/roles';

/**
 * Sign in, and the account button.
 *
 * Privy's modal handles Google, GitHub and email in one place, so there is one
 * button rather than a sign-in and sign-up pair. The account menu shows the
 * Monad wallet that came with the account, since that is what the studio
 * deploys and signs with when no browser wallet is installed.
 */

export interface AuthControlsProps {
    /** Rendered smaller for the studio toolbar. */
    compact?: boolean;
    /** Shown next to the avatar when known. */
    tier?: Tier;
    /** Admins get a link to the admin area. */
    isAdmin?: boolean;
}

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function AuthControls({ compact = false, tier, isAdmin = false }: AuthControlsProps) {
    const { configured, isLoaded, isSignedIn, email, walletAddress, openSignIn, signOut } = useAuthState();
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const menu = useRef<HTMLDivElement>(null);
    const size = compact ? 'px-3 py-1.5 text-[12px]' : 'px-4 py-2 text-[13px]';

    useEffect(() => {
        if (!open) return;
        const close = (event: MouseEvent | KeyboardEvent) => {
            if (event instanceof KeyboardEvent ? event.key === 'Escape' : !menu.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', close);
        return () => {
            document.removeEventListener('mousedown', close);
            document.removeEventListener('keydown', close);
        };
    }, [open]);

    if (!configured || !isLoaded) return null;

    if (!isSignedIn) {
        return (
            <button
                type="button"
                onClick={openSignIn}
                className={`rounded-lg bg-text-primary font-semibold text-background outline-none ring-accent-line ring-offset-2 ring-offset-background transition-opacity hover:opacity-90 focus-visible:ring-2 ${size}`}
            >
                Sign in
            </button>
        );
    }

    const initial = (email ?? 'M').charAt(0).toUpperCase();

    return (
        <div className="flex items-center gap-2.5">
            {isAdmin && (
                <Link
                    href="/admin"
                    className={`rounded-lg border border-accent-line bg-accent-soft font-medium text-accent transition-opacity hover:opacity-80 ${size}`}
                >
                    Admin
                </Link>
            )}
            {tier !== undefined && tier !== 'free' && (
                <span className="hidden rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent sm:inline">
                    {TIER_LABELS[tier]}
                </span>
            )}
            <div ref={menu} className="relative">
                <button
                    type="button"
                    onClick={() => setOpen((value) => !value)}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    aria-label="Account"
                    className={`flex items-center justify-center rounded-full bg-accent font-semibold text-white outline-none ring-accent-line ring-offset-2 ring-offset-background focus-visible:ring-2 ${compact ? 'h-7 w-7 text-[12px]' : 'h-8 w-8 text-[13px]'}`}
                >
                    {initial}
                </button>
                {open && (
                    <div role="menu" className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-border-subtle bg-surface-raised shadow-[var(--shadow-panel)]">
                        <div className="border-b border-border-subtle px-3.5 py-3">
                            <p className="truncate text-[13px] font-medium text-text-primary">{email ?? 'Signed in'}</p>
                            {walletAddress !== null && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        void navigator.clipboard.writeText(walletAddress).then(() => {
                                            setCopied(true);
                                            setTimeout(() => setCopied(false), 1500);
                                        });
                                    }}
                                    className="mt-1.5 flex w-full items-center gap-1.5 rounded-md text-left text-[12px] text-text-muted outline-none ring-accent-line hover:text-text-primary focus-visible:ring-2"
                                    title="Your Monad wallet, created with your account. The studio deploys with it when no browser wallet is installed."
                                >
                                    <Wallet size={12} aria-hidden />
                                    <span className="font-mono">{short(walletAddress)}</span>
                                    {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
                                </button>
                            )}
                        </div>
                        <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                                setOpen(false);
                                void signOut();
                            }}
                            className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] text-text-secondary outline-none hover:bg-surface-sunken hover:text-text-primary focus-visible:bg-surface-sunken"
                        >
                            <LogOut size={13} aria-hidden />
                            Sign out
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
