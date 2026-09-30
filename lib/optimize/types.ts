/**
 * What the optimize stream sends, shared by the route and the dialog.
 */

import type { ContractReport, Grade, SeverityCounts } from '../report/types';

export type OptimizeStage = 'rewriting' | 'compiling' | 'reporting' | 'refining' | 'saving';

export interface ScoreSnapshot {
    score: number | null;
    grade: Grade | null;
    counts: SeverityCounts;
    deployGas: number | null;
    parallelScore: number | null;
}

export interface OptimizeChange {
    title: string;
    why: string;
    /** Titles of the audit findings the change set out to fix. */
    fixes: string[];
}

export interface OptimizeResult {
    /** The report run on the optimized contract. */
    reportId: string;
    path: string;
    original: string;
    optimized: string;
    changes: OptimizeChange[];
    before: ScoreSnapshot;
    after: ScoreSnapshot;
    lines: { added: number; removed: number };
    /** Whether the new report scores higher; nothing is charged when it does not. */
    improved: boolean;
    /** Whether this used one of the free optimizations. */
    free: boolean;
}

export type OptimizeEvent =
    | { type: 'stage'; stage: OptimizeStage; label: string }
    | { type: 'progress'; done: number; total: number; label: string }
    | { type: 'done'; result: OptimizeResult }
    | { type: 'error'; message: string };

export function snapshotOf(contract: ContractReport): ScoreSnapshot {
    const gas = contract.sections.gas;
    const parallel = contract.sections.parallel;
    const deploy = gas.status === 'ok' ? gas.data?.deployment?.totalCost : undefined;
    const parallelScore = parallel.status === 'ok' ? parallel.data?.score : undefined;
    return {
        score: contract.health?.score ?? null,
        grade: contract.health?.grade ?? null,
        counts: contract.counts,
        deployGas: typeof deploy === 'number' ? deploy : null,
        parallelScore: typeof parallelScore === 'number' ? Math.round(parallelScore) : null,
    };
}
