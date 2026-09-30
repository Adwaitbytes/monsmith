'use client';

import { useEffect, useState } from 'react';

import type { Plan } from './offer';

function isPlan(value: unknown): value is Plan {
    if (typeof value !== 'object' || value === null) return false;
    const plan = value as Record<string, unknown>;
    return typeof plan.paywall === 'boolean' && typeof plan.freeReports === 'number';
}

/**
 * The server's offer, or null until it arrives or if it cannot be read.
 *
 * Null renders as silence rather than a guess: the start screen leaves the
 * pricing line out instead of printing a number that might be wrong.
 */
export function usePlan(): Plan | null {
    const [plan, setPlan] = useState<Plan | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        fetch('/api/billing/plan', { signal: controller.signal })
            .then((response) => (response.ok ? response.json() : null))
            .then((data: unknown) => {
                if (isPlan(data)) setPlan(data);
            })
            .catch((error: unknown) => {
                if (error instanceof DOMException && error.name === 'AbortError') return;
                console.error('Could not read the report offer:', error);
            });
        return () => controller.abort();
    }, []);

    return plan;
}
