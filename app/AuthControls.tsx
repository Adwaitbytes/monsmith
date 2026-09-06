'use client';

import React from 'react';
import Link from 'next/link';
import { Show, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';

import type { Tier } from '@/lib/auth/roles';
import { TIER_LABELS } from '@/lib/auth/roles';

/**
 * Sign in, sign up, and the account button.
 *
 * Styled against the app's own tokens rather than Clerk's defaults, because a
 * pair of buttons in a different design language is the fastest way to make a
 * product look assembled from parts.
 *
 * `Show` rather than `SignedIn`/`SignedOut`: the latter are still exported by
 * the SDK but throw at render time in Core 3. The modal keeps people on the page they
 * were reading, which matters most in the studio where signing in mid-session
 * should not discard an editor full of work.
 */

export interface AuthControlsProps {
    /** Rendered smaller for the studio toolbar. */
    compact?: boolean;
    /** Shown next to the avatar when known. */
    tier?: Tier;
    /** Admins get a link to the admin area. */
    isAdmin?: boolean;
}

export function AuthControls({ compact = false, tier, isAdmin = false }: AuthControlsProps) {
    const size = compact ? 'px-3 py-1.5 text-[12px]' : 'px-4 py-2 text-[13px]';

    return (
        <>
            <Show when="signed-out">
                <div className="flex items-center gap-2">
                    <SignInButton mode="modal">
                        <button
                            className={`rounded-lg border border-border-subtle font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary ${size}`}
                        >
                            Sign in
                        </button>
                    </SignInButton>
                    <SignUpButton mode="modal">
                        <button
                            className={`rounded-lg bg-text-primary font-semibold text-background transition-opacity hover:opacity-90 ${size}`}
                        >
                            Sign up
                        </button>
                    </SignUpButton>
                </div>
            </Show>

            <Show when="signed-in">
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
                    <UserButton
                        appearance={{
                            elements: {
                                avatarBox: compact ? 'h-7 w-7' : 'h-8 w-8',
                            },
                        }}
                    />
                </div>
            </Show>
        </>
    );
}
