'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';

export interface OptimizeAllowance {
    paywall: boolean;
    freeAllowance: number;
    freeLeft: number | null;
    signedIn: boolean;
}

function isAllowance(value: unknown): value is OptimizeAllowance {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    return typeof record.paywall === 'boolean' && typeof record.freeAllowance === 'number';
}

/** The viewer's free optimizations, refreshed on sign-in and on demand. */
export function useOptimizeAllowance(): [OptimizeAllowance | null, () => void] {
    const { userId, isLoaded } = useAuth();
    const [allowance, setAllowance] = useState<OptimizeAllowance | null>(null);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (!isLoaded) return;
        const controller = new AbortController();
        fetch('/api/optimize/allowance', { signal: controller.signal })
            .then((response) => (response.ok ? response.json() : null))
            .then((data: unknown) => {
                if (isAllowance(data)) setAllowance(data);
            })
            .catch((error: unknown) => {
                if (error instanceof DOMException && error.name === 'AbortError') return;
                console.error('Could not read the optimization allowance:', error);
            });
        return () => controller.abort();
    }, [userId, isLoaded, tick]);

    const refresh = useCallback(() => setTick((value) => value + 1), []);
    return [allowance, refresh];
}
