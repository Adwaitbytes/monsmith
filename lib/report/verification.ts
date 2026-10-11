import type { RepoReport } from './types';

/**
 * Who cross-examined a report's findings, said the way a reader would say it.
 *
 * The review pass records the model id that answered. That id is for the
 * machine; the report says "Qwen 3.8 Max", and an id nobody has a name for is
 * shown as it is rather than guessed at.
 */

const NAMES: ReadonlyArray<readonly [RegExp, string]> = [
    [/^qwen\/qwen3\.8-max/, 'Qwen 3.8 Max'],
    [/^anthropic\/claude-sonnet-5\.5/, 'Claude Sonnet 5.5'],
    [/^deepseek\/deepseek-v4\.1-flash/, 'DeepSeek V4.1 Flash'],
    [/^moonshotai\/kimi-k3/, 'Kimi K3'],
];

export function modelName(id: string): string {
    return NAMES.find(([pattern]) => pattern.test(id))?.[1] ?? id;
}

export interface VerificationSummary {
    models: string[];
    upheld: number;
    rejected: number;
}

/** Totals across every contract the review pass ran on, or null when it ran on none. */
export function verificationSummary(report: Pick<RepoReport, 'contracts'>): VerificationSummary | null {
    const verified = (Array.isArray(report.contracts) ? report.contracts : []).flatMap((contract) =>
        contract.verification === undefined ? [] : [contract.verification],
    );
    if (verified.length === 0) return null;
    return {
        models: [...new Set(verified.map((entry) => modelName(entry.model)))],
        upheld: verified.reduce((sum, entry) => sum + entry.upheld, 0),
        rejected: verified.reduce((sum, entry) => sum + entry.rejected, 0),
    };
}

export function verificationSentence(summary: VerificationSummary): string {
    const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
    return `Every AI finding was cross-examined by ${summary.models.join(' and ')}: ${plural(summary.upheld, 'finding')} upheld, ${plural(summary.rejected, 'candidate')} rejected for lack of a working attack.`;
}
