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

    return { state, start, reset };
}
