'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ArrowUp, Loader2, MessageSquare, Phone, Sparkles, X } from 'lucide-react';

import type { Finding } from '@/lib/report/types';
import { useIDEStore } from '@/lib/store';
import { Markdown } from './Markdown';

/**
 * A floating assistant that has read the file you are looking at.
 *
 * The thing that separates this from a chat box bolted onto a product is what
 * goes up with every message: the open file with its real line numbers, and the
 * findings the audit already produced. Asked why something is unsafe, it
 * answers about line 41 of your contract instead of about reentrancy in
 * general, and it argues from the same findings the report showed you rather
 * than a second opinion that contradicts it.
 *
 * It is Aria, the same assistant as the voice call, so there is one entry point
 * rather than two pills that look like two products. Typing is the default and
 * the call is one button away in the header.
 *
 * Floating rather than docked because it is not a mode. You reach for it in the
 * middle of reading something, get an answer, and go back to what you were
 * doing; a dock would make that a layout change every time.
 *
 * The suggested questions are not decoration. A blank chat input is the hardest
 * thing in any assistant to start with, and these are derived from what is
 * actually on screen, so the first click always produces something relevant.
 */

interface Turn {
    role: 'user' | 'assistant';
    content: string;
}

export interface AssistantProps {
    /** The file in the editor, sent with every turn. */
    code: string;
    fileName: string;
    /** What the audit found, so the assistant and the report agree. */
    findings?: readonly Finding[];
    /** Markdown rendering still keys off the theme rather than tokens. */
    isDark?: boolean;
}

function suggestionsFor(code: string, findings: readonly Finding[]): string[] {
    const out: string[] = [];

    // The worst finding first: it is the thing they most likely opened this to
    // ask about, and quoting its title makes the answer land on the right line.
    const worst = [...findings].sort((a, b) => {
        const order = ['critical', 'high', 'medium', 'low', 'info'];
        return order.indexOf(a.severity) - order.indexOf(b.severity);
    })[0];
    if (worst !== undefined) out.push(`How would someone exploit "${worst.title}"?`);

    if (/\.call\{value:/.test(code)) out.push('Is the external call here safe?');
    if (/for\s*\(/.test(code)) out.push('Can any loop in this run out of gas?');
    if (code.length > 0) out.push('What would you change before mainnet?');
    out.push('How well does this parallelise on Monad?');

    return out.slice(0, 3);
}

export function Assistant({
    code,
    fileName,
    findings = [],
    isDark = false,
}: AssistantProps) {
    const [open, setOpen] = useState(false);
    const setAssistantMounted = useIDEStore((state) => state.setAssistantMounted);
    const requestAriaCall = useIDEStore((state) => state.requestAriaCall);

    // While this is on the page it is the only Aria button; the root layout's
    // call pill steps aside and takes its calls from here instead.
    useEffect(() => {
        setAssistantMounted(true);
        return () => setAssistantMounted(false);
    }, [setAssistantMounted]);
    const [turns, setTurns] = useState<Turn[]>([]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const reduce = useReducedMotion();

    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (!open) return;
        const frame = requestAnimationFrame(() => inputRef.current?.focus());
        return () => cancelAnimationFrame(frame);
    }, [open]);

    // A new answer is only useful if you can see it.
    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [turns, busy]);

    const ask = useCallback(
        async (question: string) => {
            const text = question.trim();
            if (text.length === 0 || busy) return;

            setError(null);
            setInput('');
            setBusy(true);
            const history = turns;
            setTurns((current) => [...current, { role: 'user', content: text }]);

            try {
                const response = await fetch('/api/assistant', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: text,
                        history,
                        code,
                        fileName,
                        findings: findings.slice(0, 20).map((finding) => ({
                            severity: finding.severity,
                            title: finding.title,
                            line: finding.line,
                        })),
                    }),
                });
                const data = (await response.json()) as { answer?: string; error?: string };

                if (!response.ok || typeof data.answer !== 'string') {
                    setError(data.error ?? 'The assistant could not answer.');
                    // The question stays in the thread so it can be retried
                    // without retyping, rather than vanishing with the failure.
                    return;
                }
                setTurns((current) => [...current, { role: 'assistant', content: data.answer as string }]);
            } catch {
                setError('Could not reach the assistant.');
            } finally {
                setBusy(false);
            }
        },
        [busy, turns, code, fileName, findings],
    );

    const suggestions = suggestionsFor(code, findings);

    return (
        <>
            {/* The handle. Low weight when closed, so it never competes. */}
            <AnimatePresence>
                {!open && (
                    <motion.button
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: reduce ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
                        onClick={() => setOpen(true)}
                        aria-label="Ask Aria"
                        className="group fixed bottom-9 right-5 z-40 flex items-center gap-2 print:hidden rounded-full border border-border-subtle bg-surface-raised py-2.5 pl-3.5 pr-4 shadow-[var(--shadow-panel)] outline-none ring-accent-line transition-transform hover:-translate-y-0.5 focus-visible:ring-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                    >
                        <Sparkles size={15} className="text-accent" />
                        <span className="text-[12.5px] font-medium text-text-primary">Ask Aria</span>
                    </motion.button>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {open && (
                    <motion.aside
                        role="dialog"
                        aria-label="Aria"
                        initial={{ opacity: 0, y: 12, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 12, scale: 0.98 }}
                        transition={{ duration: reduce ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
                        className="fixed bottom-9 right-5 z-40 flex h-[min(34rem,70vh)] print:hidden w-[min(24rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface-raised shadow-[var(--shadow-panel)]"
                    >
                        <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
                            <Sparkles size={14} className="text-accent" />
                            <h2 className="flex-1 font-display text-[13.5px] font-semibold text-text-primary">
                                Aria
                            </h2>
                            <span className="truncate font-mono text-[10.5px] text-text-muted">
                                {fileName}
                            </span>
                            <button
                                onClick={() => {
                                    setOpen(false);
                                    requestAriaCall();
                                }}
                                aria-label="Call Aria"
                                title="Call Aria"
                                className="rounded-md p-1 text-text-muted outline-none ring-accent-line transition-colors hover:text-accent focus-visible:ring-2"
                            >
                                <Phone size={13} />
                            </button>
                            <button
                                onClick={() => setOpen(false)}
                                aria-label="Close Aria"
                                className="rounded-md p-1 text-text-muted outline-none ring-accent-line transition-colors hover:text-text-primary focus-visible:ring-2"
                            >
                                <X size={14} />
                            </button>
                        </header>

                        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                            {turns.length === 0 && (
                                <div className="pt-2">
                                    <MessageSquare size={18} className="text-text-muted" />
                                    <p className="mt-2.5 text-[13px] leading-relaxed text-text-secondary">
                                        Ask about the file you have open. It can see the code and
                                        what the audit found, so it answers about your contract
                                        rather than in general.
                                    </p>
                                    <div className="mt-4 space-y-1.5">
                                        {suggestions.map((suggestion) => (
                                            <button
                                                key={suggestion}
                                                onClick={() => void ask(suggestion)}
                                                className="block w-full rounded-lg border border-border-subtle px-3 py-2 text-left text-[12.5px] text-text-secondary outline-none ring-accent-line transition-colors hover:border-border-strong hover:text-text-primary focus-visible:ring-2"
                                            >
                                                {suggestion}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {turns.map((turn, index) => (
                                <div key={index} className="mb-3.5">
                                    {turn.role === 'user' ? (
                                        <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3 py-2 text-[12.5px] leading-relaxed text-white">
                                            {turn.content}
                                        </p>
                                    ) : (
                                        <div className="max-w-full text-[12.5px] leading-relaxed text-text-primary [&_code]:font-mono [&_code]:text-[11.5px] [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-surface-sunken [&_pre]:p-2.5">
                                            <Markdown content={turn.content} isDark={isDark} />
                                        </div>
                                    )}
                                </div>
                            ))}

                            {busy && (
                                <p className="flex items-center gap-1.5 text-[12px] text-text-muted">
                                    <Loader2 size={12} className="animate-spin motion-reduce:animate-none" />
                                    Reading your contract
                                </p>
                            )}

                            {error !== null && (
                                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:text-red-300">
                                    {error}
                                </p>
                            )}
                        </div>

                        <div className="border-t border-border-subtle p-2.5">
                            <div className="flex items-end gap-2 rounded-xl border border-border-subtle bg-surface-sunken px-3 py-2 transition-colors focus-within:border-accent-line">
                                <textarea
                                    ref={inputRef}
                                    value={input}
                                    onChange={(event) => setInput(event.target.value)}
                                    onKeyDown={(event) => {
                                        // Enter sends, shift+enter writes a line: the
                                        // convention every chat input already has.
                                        if (event.key === 'Enter' && !event.shiftKey) {
                                            event.preventDefault();
                                            void ask(input);
                                        }
                                    }}
                                    rows={1}
                                    placeholder="Ask Aria about this contract"
                                    aria-label="Ask Aria"
                                    className="max-h-24 min-h-[20px] flex-1 resize-none bg-transparent text-[12.5px] text-text-primary outline-none placeholder:text-text-muted"
                                />
                                <button
                                    onClick={() => void ask(input)}
                                    disabled={busy || input.trim().length === 0}
                                    aria-label="Send"
                                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg outline-none ring-accent-line transition-colors focus-visible:ring-2 ${
                                        busy || input.trim().length === 0
                                            ? 'bg-surface-overlay text-text-muted'
                                            : 'bg-accent text-white hover:opacity-90'
                                    }`}
                                >
                                    <ArrowUp size={13} />
                                </button>
                            </div>
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>
        </>
    );
}
