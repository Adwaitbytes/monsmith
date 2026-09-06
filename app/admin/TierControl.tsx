'use client';

import React, { useState, useTransition } from 'react';

import { TIER_LABELS, type Tier } from '@/lib/auth/roles';

/**
 * Changes one account's tier.
 *
 * Optimistic on the client and authoritative on the server: the select moves
 * immediately, and reverts if the write is refused. Refusal is the expected
 * path for anyone who is not an admin, since the API checks the permission
 * again rather than trusting that this component was only rendered for admins.
 */

const TIERS: Tier[] = ['free', 'pro', 'enterprise'];

export function TierControl({ userId, tier }: { userId: string; tier: string }) {
    const [value, setValue] = useState<string>(tier);
    const [error, setError] = useState(false);
    const [pending, startTransition] = useTransition();

    const change = (next: string) => {
        const previous = value;
        setValue(next);
        setError(false);

        startTransition(async () => {
            try {
                const response = await fetch('/api/admin/tier', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, tier: next }),
                });
                if (!response.ok) throw new Error('refused');
            } catch {
                setValue(previous);
                setError(true);
            }
        });
    };

    return (
        <span className="flex items-center gap-2">
            <select
                value={value}
                disabled={pending}
                onChange={(event) => change(event.target.value)}
                aria-label={`Tier for ${userId}`}
                className={`rounded-lg border bg-transparent px-2 py-1 text-[12px] text-text-primary outline-none transition-colors disabled:opacity-50 ${
                    error ? 'border-red-500/50' : 'border-border-subtle focus:border-accent-line'
                }`}
            >
                {TIERS.map((option) => (
                    <option key={option} value={option}>
                        {TIER_LABELS[option]}
                    </option>
                ))}
            </select>
            {error && <span className="text-[11px] text-red-600 dark:text-red-400">failed</span>}
        </span>
    );
}
