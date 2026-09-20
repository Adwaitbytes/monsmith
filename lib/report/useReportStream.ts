'use client';

import { useCallback, useRef, useState } from 'react';

import { visitorId } from '../track';
import {
    emptyCounts,
    type ContractReport,
    type ReportEvent,
    type ReportOrigin,
    type RepoReport,
    type SectionKind,
    type Section,
} from './types';

/**
 * Consuming a report as it is produced.
 *
 * A full-repository audit compiles every contract, runs each one in a local EVM
 * and reprices the trace against several gas schedules. On a real repository
 * that is minutes of work, which rules out a request that returns a finished
 * report: the connection would time out, and long before that the user would
 * have concluded the product had hung.
 *
 * So the route streams, and this hook assembles. Every section arrives on its
 * own and is folded into a partial report immediately, which means the rail can
 * show a finished security section while the gas numbers are still being
 * measured. The progress the user sees is the real progress, not an animation
 * standing in for one.
 *
 * `fetch` with a reader is used rather than `EventSource`, because the audit is
 * a POST carrying the whole workspace and `EventSource` can only issue a GET.
 */

export type ReportStreamState =
    | { status: 'idle' }
    | {
          status: 'running';
          done: number;
          total: number;
          label: string;
          partial: RepoReport | null;
      }
    | { status: 'ready'; report: RepoReport }
    | { status: 'error'; message: string };

export interface RunReportInput {
    files: Record<string, string>;
    origin: ReportOrigin;
    chains?: string[];
}

/** Sections land one at a time, so a contract exists before it is complete. */
function applySection(
    partial: RepoReport,
    contractId: string,
    section: SectionKind,
    result: Section<unknown>,
): RepoReport {
    return {
        ...partial,
        contracts: partial.contracts.map((contract) =>
            contract.id === contractId
                ? { ...contract, sections: { ...contract.sections, [section]: result } }
                : contract,
        ),
    };
}

function applyContract(partial: RepoReport, contract: ContractReport): RepoReport {
    const known = partial.contracts.some((entry) => entry.id === contract.id);
    return {
        ...partial,
        contracts: known
            ? partial.contracts.map((entry) => (entry.id === contract.id ? contract : entry))
            : [...partial.contracts, contract],
    };
}

/**
 * Splits a byte stream into server-sent events.
 *
 * Chunk boundaries fall wherever the network puts them, which is routinely in
 * the middle of a JSON payload. Holding the remainder between chunks is the
 * whole job; without it a large report drops exactly the events that matter
 * most, since those are the biggest ones.
 */
function* parseEvents(buffer: string): Generator<{ event: ReportEvent | null; rest: string }> {
    let rest = buffer;
    let index = rest.indexOf('\n\n');

    while (index !== -1) {
        const frame = rest.slice(0, index);
        rest = rest.slice(index + 2);

        const payload = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('');

        if (payload.length > 0) {
            try {
                yield { event: JSON.parse(payload) as ReportEvent, rest };
            } catch {
                // A frame we cannot parse is one lost section, not a lost
                // report. Dropping it beats tearing down a four minute run.
                yield { event: null, rest };
            }
        }
        index = rest.indexOf('\n\n');
    }

    yield { event: null, rest };
}

export function useReportStream() {
    const [state, setState] = useState<ReportStreamState>({ status: 'idle' });
    const abortRef = useRef<AbortController | null>(null);

    const cancel = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setState({ status: 'idle' });
    }, []);

    const run = useCallback(async (input: RunReportInput) => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setState({ status: 'running', done: 0, total: 0, label: 'Reading the workspace', partial: null });

        let partial: RepoReport | null = null;

        try {
            const response = await fetch('/api/report', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // The anonymous owner of the report, so a signed-out
                    // visitor still gets their first one free and can come
                    // back to a permalink they already paid for.
                    'x-visitor-id': visitorId(),
                },
                body: JSON.stringify({ ...input, visitorId: visitorId() }),
                signal: controller.signal,
            });

            if (!response.ok || response.body === null) {
                // An error before the stream opens arrives as ordinary JSON,
                // which is the only shape that can carry a readable reason.
                const detail = await response.json().catch(() => null);
                const message =
                    detail !== null && typeof detail === 'object' && 'error' in detail
                        ? String((detail as { error: unknown }).error)
                        : `The analysis could not start (${response.status}).`;
                setState({ status: 'error', message });
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                for (const parsed of parseEvents(buffer)) {
                    buffer = parsed.rest;
                    const event = parsed.event;
                    if (event === null) continue;

                    switch (event.type) {
                        case 'started':
                            partial = {
                                reportId: event.reportId,
                                createdAt: new Date().toISOString(),
                                origin: input.origin,
                                health: null,
                                counts: emptyCounts(),
                                contracts: event.planned.map((entry) => ({
                                    id: entry.id,
                                    path: entry.path,
                                    name: entry.path,
                                    health: null,
                                    findings: [],
                                    counts: emptyCounts(),
                                    sections: {
                                        security: { status: 'pending' },
                                        parallel: { status: 'pending' },
                                        gas: { status: 'pending' },
                                        chainfit: { status: 'pending' },
                                    },
                                })),
                                skipped: event.skipped,
                                notes: [],
                                redacted: false,
                            };
                            setState({
                                status: 'running',
                                done: 0,
                                total: event.planned.length,
                                label: 'Compiling',
                                partial,
                            });
                            break;

                        case 'section':
                            if (partial === null) break;
                            partial = applySection(
                                partial,
                                event.contractId,
                                event.section,
                                event.result,
                            );
                            setState((current) =>
                                current.status === 'running'
                                    ? { ...current, partial }
                                    : current,
                            );
                            break;

                        case 'contract':
                            if (partial === null) break;
                            partial = applyContract(partial, event.contract);
                            setState((current) =>
                                current.status === 'running'
                                    ? { ...current, partial }
                                    : current,
                            );
                            break;

                        case 'progress':
                            setState((current) =>
                                current.status === 'running'
                                    ? {
                                          ...current,
                                          done: event.done,
                                          total: event.total,
                                          label: event.label,
                                      }
                                    : current,
                            );
                            break;

                        case 'complete':
                            partial = event.report;
                            setState({ status: 'ready', report: event.report });
                            break;

                        case 'error':
                            setState({ status: 'error', message: event.message });
                            break;
                    }
                }
            }

            // A stream that ends without a `complete` event means the function
            // was cut off. Whatever finished is still worth showing, so the
            // partial is promoted rather than discarded.
            setState((current) => {
                if (current.status !== 'running') return current;
                if (partial === null) {
                    return {
                        status: 'error',
                        message: 'The analysis stopped before it produced anything.',
                    };
                }
                return {
                    status: 'ready',
                    report: {
                        ...partial,
                        notes: [
                            ...partial.notes,
                            'The analysis was cut short, so some sections were not measured.',
                        ],
                    },
                };
            });
        } catch (error) {
            if (controller.signal.aborted) return;
            setState({
                status: 'error',
                message: error instanceof Error ? error.message : 'The analysis failed.',
            });
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
        }
    }, []);

    /**
     * Swaps in a report the server handed back whole.
     *
     * Unlocking returns the full report rather than a patch, because the paid
     * half is assembled server-side and a client-side merge would be a second
     * place where the two halves could disagree. Replacing outright keeps the
     * redaction decision in exactly one place.
     */
    const replace = useCallback((next: RepoReport) => {
        setState({ status: 'ready', report: next });
    }, []);

    return { state, run, cancel, replace };
}
