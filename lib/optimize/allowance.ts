/**
 * Who may optimize a contract, and whether it uses one of their free ones.
 *
 * Mirrors the report offer so the product has one rule a person can remember:
 * with an account, the first two of each are free; after that, paying for a
 * report includes optimizing it. Pure, so the whole table of cases is tested.
 */

import { freeReportAllowance } from '../report/freeReports';

export const FREE_OPTIMIZATIONS: number = freeReportAllowance(process.env.OPTIMIZATIONS_FREE);

export interface OptimizeAsk {
    paywall: boolean;
    signedIn: boolean;
    /** A paying tier with no per-report limits. */
    unlimited: boolean;
    freeUsed: number;
    freeAllowance: number;
    /** Someone paid for the report being optimized. */
    reportPaid: boolean;
}

export type OptimizeDecision =
    | { allowed: true; free: boolean }
    | { allowed: false; reason: 'sign-in' | 'pay'; message: string };

export function decideOptimize(ask: OptimizeAsk): OptimizeDecision {
    // Off means the product is free; nothing is counted against anyone.
    if (!ask.paywall || ask.unlimited) return { allowed: true, free: false };
    if (!ask.signedIn) {
        return {
            allowed: false,
            reason: 'sign-in',
            message: `Sign in to optimize. Your first ${ask.freeAllowance} optimizations are free.`,
        };
    }
    // Paying for a report includes optimizing it, so that never spends a free one.
    if (ask.reportPaid) return { allowed: true, free: false };
    if (ask.freeUsed < ask.freeAllowance) return { allowed: true, free: true };
    return {
        allowed: false,
        reason: 'pay',
        message: `You have used your ${ask.freeAllowance} free optimizations. Unlocking this report includes optimizing it.`,
    };
}
