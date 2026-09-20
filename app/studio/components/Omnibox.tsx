'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Boxes, FileCode, Github, Loader2 } from 'lucide-react';

import { parseRepoInput, type RepoRef } from '@/lib/github/source';

/**
 * One box for every way of getting a contract into the studio.
 *
 * It replaces four separate entry points: import from GitHub, paste a URL,
 * look up a deployed address, and paste source. Each of those was a mode the
 * user had to choose before typing, which meant guessing which of four buttons
 * matched whatever was already on their clipboard.
 *
 * The win is that the mode is inferred, never picked. The chip beside the box
 * reports what was recognised as the user types, so the inference is visible
 * and correctable rather than a surprise on submit. Recognition order is
 * deliberate: a repository reference is the most specific shape, an address is
 * exact, and Solidity is the catch-all, so each test only runs on input the
 * previous one declined.
 *
 * Nothing here is an error state. Input that matches nothing yet is almost
 * always input that is still being typed, and colouring a half-typed address
 * red teaches people to distrust the box.
 */

export type OmniboxIntent =
    | { kind: 'repo'; ref: RepoRef }
    | { kind: 'address'; address: string }
    | { kind: 'source'; code: string };

export interface OmniboxProps {
    onSubmit: (intent: OmniboxIntent) => void;
    /** Locks submission while the previous intent is still running. */
    busy?: boolean;
    placeholder?: string;
    autoFocus?: boolean;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLIDITY = /pragma\s+solidity|\b(?:abstract\s+)?contract\s+[A-Za-z_$]/;

/** Beyond this the box scrolls rather than eating the page. */
const MAX_HEIGHT = 240;
/** Room a pasted file gets straight away, so you can see what landed. */
const PASTED_HEIGHT = 132;

function detectIntent(raw: string): OmniboxIntent | null {
    const text = raw.trim();
    if (text.length === 0) return null;

    const ref = parseRepoInput(text);
    if (ref !== null) return { kind: 'repo', ref };

    if (ADDRESS.test(text)) return { kind: 'address', address: text };

    // Source keeps the untrimmed original: leading indentation is part of the
    // file and the compiler will report line numbers against it.
    if (SOLIDITY.test(text)) return { kind: 'source', code: raw };

    return null;
}

function describe(intent: OmniboxIntent): { label: string; detail: string; icon: React.ReactNode } {
    switch (intent.kind) {
        case 'repo': {
            const { owner, repo, ref, subdir } = intent.ref;
            const branch = ref !== undefined && ref.length > 0 ? ` at ${ref}` : '';
            const folder = subdir !== undefined && subdir.length > 0 ? ` / ${subdir}` : '';
            return {
                label: 'GitHub repo',
                detail: `${owner}/${repo}${branch}${folder}`,
                icon: <Github size={12} aria-hidden />,
            };
        }
        case 'address':
            return {
                label: 'Contract address',
                detail: `${intent.address.slice(0, 10)}...${intent.address.slice(-6)}`,
                icon: <Boxes size={12} aria-hidden />,
            };
        case 'source': {
            const lines = intent.code.trim().split('\n').length;
            return {
                label: 'Solidity source',
                detail: `${lines} line${lines === 1 ? '' : 's'}`,
                icon: <FileCode size={12} aria-hidden />,
            };
        }
    }
}

export function Omnibox({
    onSubmit,
    busy = false,
    placeholder = 'Paste a GitHub repo, a contract address, or Solidity source',
    autoFocus = false,
}: OmniboxProps) {
    const [value, setValue] = useState('');
    const [floor, setFloor] = useState(0);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const intent = useMemo(() => detectIntent(value), [value]);
    const chip = intent === null ? null : describe(intent);
    const canSubmit = intent !== null && !busy;

    useEffect(() => {
        if (autoFocus) inputRef.current?.focus();
    }, [autoFocus]);

    /**
     * Grows the box to fit its content. Running on every value change rather
     * than on paste alone means a line typed by hand and a file dropped in
     * behave identically, which is the only way the single box holds together.
     */
    useEffect(() => {
        const element = inputRef.current;
        if (element === null) return;

        element.style.height = 'auto';
        const content = element.scrollHeight;
        element.style.height = `${Math.min(Math.max(content, floor), MAX_HEIGHT)}px`;
        element.style.overflowY = content > MAX_HEIGHT ? 'auto' : 'hidden';
    }, [value, floor]);

    const submit = () => {
        if (intent === null || busy) return;
        onSubmit(intent);
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        // An IME candidate window uses Enter to commit a character, and
        // submitting underneath it would swallow the keystroke.
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        submit();
    };

    const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const pasted = event.clipboardData.getData('text');
        // A pasted file gets a roomier box immediately. Hugging the content
        // exactly would be correct and useless: you could not see what arrived.
        setFloor(pasted.includes('\n') && SOLIDITY.test(pasted) ? PASTED_HEIGHT : 0);
    };

    return (
        <div className="w-full">
            <div className="panel-surface flex items-start gap-3 rounded-xl border border-border-subtle p-2 pl-3.5 shadow-[var(--shadow-panel)] transition-colors duration-150 focus-within:border-accent-line">
                <textarea
                    ref={inputRef}
                    rows={1}
                    value={value}
                    onChange={(event) => {
                        setValue(event.target.value);
                        if (event.target.value.trim().length === 0) setFloor(0);
                    }}
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                    placeholder={placeholder}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="Repository, contract address, or Solidity source"
                    aria-describedby="omnibox-status"
                    disabled={busy}
                    className={`min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[13.5px] leading-6 text-text-primary placeholder:text-text-muted focus:outline-none disabled:opacity-60 ${
                        intent?.kind === 'source' ? 'font-mono text-[12.5px]' : ''
                    }`}
                />

                <button
                    type="button"
                    onClick={submit}
                    disabled={!canSubmit}
                    aria-label={chip === null ? 'Nothing to run yet' : `Run on this ${chip.label.toLowerCase()}`}
                    className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition-all duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised ${
                        canSubmit
                            ? 'bg-accent text-white hover:opacity-90 active:scale-[0.98]'
                            : 'cursor-not-allowed bg-surface-sunken text-text-muted'
                    }`}
                >
                    {busy ? (
                        <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden />
                    ) : (
                        <ArrowRight size={13} aria-hidden />
                    )}
                    {busy ? 'Working' : 'Analyse'}
                </button>
            </div>

            <div
                id="omnibox-status"
                aria-live="polite"
                className="flex min-h-[1.75rem] flex-wrap items-center gap-x-2.5 gap-y-1 px-1 pt-2 text-[11.5px]"
            >
                {chip !== null ? (
                    <>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-line bg-accent-soft px-2 py-0.5 font-medium text-accent">
                            {chip.icon}
                            {chip.label}
                        </span>
                        <span className="truncate font-mono text-text-muted">{chip.detail}</span>
                        {intent.kind === 'source' && (
                            <span className="ml-auto hidden text-text-muted sm:inline">
                                Shift and Enter for a new line
                            </span>
                        )}
                    </>
                ) : (
                    <span className="text-text-muted">
                        {value.trim().length === 0
                            ? 'A repo link, an owner/name, a deployed address, or pasted source all work here.'
                            : 'Still reading that one. A GitHub link, a 0x address, or Solidity source will be picked up automatically.'}
                    </span>
                )}
            </div>
        </div>
    );
}
