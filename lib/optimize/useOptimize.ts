'use client';

import { useCallback, useRef, useState } from 'react';

import { parseServerEvents } from '../sse';
import { visitorId } from '../visitor';
import type { OptimizeEvent, OptimizeResult, OptimizeStage } from './types';

export type OptimizeState =
    | { status: 'idle' }
    | { status: 'running'; stage: OptimizeStage; label: string; progress: { done: number; total: number } | null }
    | { status: 'done'; result: OptimizeResult }
    | { status: 'error'; message: string; reason: 'sign-in' | 'pay' | null };

export interface OptimizeInput {
    reportId: string;
    path: string;
    files: Record<string, string>;
}

/** Drives one optimization over the streaming route. */
export function useOptimize() {
    const [state, setState] = useState<OptimizeState>({ status: 'idle' });
    const abortRef = useRef<AbortController | null>(null);

    const reset = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setState({ status: 'idle' });
    }, []);

    const start = useCallback(async (input: OptimizeInput) => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setState({ status: 'running', stage: 'rewriting', label: 'Reading the findings', progress: null });

        try {
            const response = await fetch('/api/optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-visitor-id': visitorId() },
                body: JSON.stringify(input),
                signal: controller.signal,
            });

            if (!response.ok || response.body === null) {
                const detail = (await response.json().catch(() => null)) as { error?: string; reason?: string } | null;
                const reason = detail?.reason === 'sign-in' || detail?.reason === 'pay' ? detail.reason : null;
                setState({
                    status: 'error',
                    message: detail?.error ?? `The optimization could not start (${response.status}).`,
                    reason,
                });
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let finished = false;

            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                for (const parsed of parseServerEvents<OptimizeEvent>(buffer)) {
                    buffer = parsed.rest;
                    const event = parsed.event;
                    if (event === null) continue;

                    if (event.type === 'stage') {
                        setState({ status: 'running', stage: event.stage, label: event.label, progress: null });
                    } else if (event.type === 'progress') {
                        setState((current) =>
                            current.status === 'running'
                                ? { ...current, progress: { done: event.done, total: event.total }, label: event.label }
                                : current,
                        );
                    } else if (event.type === 'done') {
                        finished = true;
                        setState({ status: 'done', result: event.result });
                    } else {
                        finished = true;
                        setState({ status: 'error', message: event.message, reason: null });
                    }
                }
            }

            if (!finished) {
                setState({ status: 'error', message: 'The connection closed before the optimization finished. Nothing was charged.', reason: null });
            }
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            setState({ status: 'error', message: 'Could not reach the optimizer. Check your connection and try again.', reason: null });
        }
    }, []);

    /**
     * Plays an optimization prepared in advance through the same stages a live
     * one shows, for the starter contracts, whose result is the same for
     * everyone and is not worth spending a model run on per click.
     */
    const replay = useCallback(async (result: OptimizeResult, durationMs: number) => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const findings = Object.values(result.before.counts).reduce((total, count) => total + count, 0);
        const steps: ReadonlyArray<{ stage: OptimizeStage; label: string; progress: { done: number; total: number } | null }> = [
            { stage: 'rewriting', label: `Drafting fixes for ${findings} ${findings === 1 ? 'finding' : 'findings'}`, progress: null },
            { stage: 'compiling', label: 'The new version compiles with every public function intact', progress: null },
            { stage: 'reporting', label: 'Re-running the full report on the new code', progress: { done: 0, total: 1 } },
            { stage: 'reporting', label: `Measured ${result.path}`, progress: { done: 1, total: 1 } },
            { stage: 'saving', label: 'Saving the new report', progress: null },
        ];
        const pause = durationMs / steps.length;
        for (const step of steps) {
            if (controller.signal.aborted) return;
            setState({ status: 'running', stage: step.stage, label: step.label, progress: step.progress });
            await new Promise((resolve) => setTimeout(resolve, pause));
        }
        if (controller.signal.aborted) return;
        setState({ status: 'done', result });
    }, []);

    return { state, start, reset, replay };
}
