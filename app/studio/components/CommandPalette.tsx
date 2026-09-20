'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'framer-motion';
import { CornerDownLeft, Search } from 'lucide-react';

/**
 * The command palette.
 *
 * The studio's top bar used to carry seventeen controls, nine of them
 * unlabelled 32px icons, two of which were the same glyph opening different
 * panels. Everything that was a rarely pressed icon lives here now. A palette
 * is the right home for that set because it is searchable: the user types what
 * they want instead of decoding a symbol, so the tenth command costs nothing,
 * where the tenth icon cost everybody.
 *
 * The filter is a hand written subsequence match rather than a fuzzy search
 * dependency. This list is tens of entries, not thousands, so the only ranking
 * that earns its keep is "what I typed starts the label", which is a few lines
 * instead of a package.
 *
 * Ordering keeps groups intact. Ranking every row globally would shuffle
 * commands across headers on each keystroke and destroy the one bit of
 * structure the user can rely on, so groups are ranked by their best member and
 * rows are ranked inside them.
 */

export interface Command {
    /** Stable across renders: it keys the row and drives aria-activedescendant. */
    id: string;
    label: string;
    /** Shown right aligned, for a shortcut or a short clarifier. */
    hint?: string;
    /** Header this command sits under. Groups render in first-seen order. */
    group: string;
    icon?: React.ReactNode;
    /** Extra words that should find this command but do not belong in the label. */
    keywords?: string[];
    run: () => void;
    /** Rendered dimmed, and skipped by keyboard navigation. */
    disabled?: boolean;
}

export interface CommandPaletteProps {
    commands: Command[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Score bands, ordered so a better kind of match always beats a worse one. */
const PREFIX = 1000;
const WORD_START = 800;
const SUBSTRING = 600;
const SUBSEQUENCE = 300;

/** Keyword and group hits sit below a label hit of the same shape, because the
 *  label is the only text the user can actually see on the row. */
const KEYWORD_PENALTY = 150;
const GROUP_PENALTY = 300;

function subsequenceScore(haystack: string, needle: string): number | null {
    let from = 0;
    let previous = -1;
    let gaps = 0;

    for (const character of needle) {
        const at = haystack.indexOf(character, from);
        if (at === -1) return null;
        if (previous !== -1) gaps += at - previous - 1;
        previous = at;
        from = at + 1;
    }

    return SUBSEQUENCE - Math.min(gaps, SUBSEQUENCE - 1);
}

function scoreText(text: string, query: string): number | null {
    const haystack = text.toLowerCase();

    if (haystack.startsWith(query)) return PREFIX - haystack.length;

    const at = haystack.indexOf(query);
    if (at !== -1) {
        const atWordStart = /[\s/._-]/.test(haystack.charAt(at - 1));
        return (atWordStart ? WORD_START : SUBSTRING) - at;
    }

    return subsequenceScore(haystack, query);
}

function scoreCommand(command: Command, query: string): number | null {
    let best = scoreText(command.label, query);

    const consider = (score: number | null, penalty: number) => {
        if (score === null) return;
        const adjusted = score - penalty;
        if (best === null || adjusted > best) best = adjusted;
    };

    for (const keyword of command.keywords ?? []) consider(scoreText(keyword, query), KEYWORD_PENALTY);
    consider(scoreText(command.group, query), GROUP_PENALTY);

    return best;
}

interface RenderGroup {
    name: string;
    commands: Command[];
    best: number;
}

function groupMatches(commands: Command[], query: string): RenderGroup[] {
    const byGroup = new Map<string, Array<{ command: Command; score: number }>>();

    for (const command of commands) {
        const score = query === '' ? 0 : scoreCommand(command, query);
        if (score === null) continue;

        const bucket = byGroup.get(command.group);
        if (bucket === undefined) byGroup.set(command.group, [{ command, score }]);
        else bucket.push({ command, score });
    }

    const groups: RenderGroup[] = [];
    for (const [name, entries] of byGroup) {
        // An empty query leaves every score at zero, so both sorts are stable
        // no-ops and the caller's own order is what the user sees at rest.
        if (query !== '') entries.sort((a, b) => b.score - a.score);
        groups.push({
            name,
            commands: entries.map((entry) => entry.command),
            best: entries.reduce((high, entry) => Math.max(high, entry.score), -Infinity),
        });
    }
    if (query !== '') groups.sort((a, b) => b.best - a.best);

    return groups;
}

export function CommandPalette({ commands, open, onOpenChange }: CommandPaletteProps) {
    // Registered unconditionally, since the shortcut has to work while the
    // palette is shut. That is the whole point of it.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
            event.preventDefault();
            onOpenChange(!open);
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, onOpenChange]);

    return (
        <AnimatePresence>
            {open && (
                <PaletteSheet
                    key="command-palette"
                    commands={commands}
                    onClose={() => onOpenChange(false)}
                />
            )}
        </AnimatePresence>
    );
}

/**
 * The open palette, split out so that mounting is what resets it.
 *
 * Query and selection start clean on every open because this component is new
 * on every open. Clearing them from an effect instead would mean a render with
 * last session's search still on screen, and a second render to correct it.
 */
function PaletteSheet({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);

    const baseId = useId();
    const listId = `${baseId}-list`;
    const inputRef = useRef<HTMLInputElement>(null);
    const rowRefs = useRef(new Map<string, HTMLElement>());

    const reduce = useReducedMotion();
    const transition: Transition = reduce ? { duration: 0 } : { duration: 0.15, ease: EASE };

    const groups = useMemo(
        () => groupMatches(commands, query.trim().toLowerCase()),
        [commands, query],
    );

    /** Render order, minus the rows Enter would refuse to run. */
    const selectable = useMemo(
        () => groups.flatMap((group) => group.commands).filter((command) => command.disabled !== true),
        [groups],
    );

    const activeCommand = selectable[Math.min(active, selectable.length - 1)];
    const rowId = (id: string) => `${baseId}-row-${id}`;

    /**
     * Takes focus on open and hands it back on close. Without the handback,
     * dismissing the palette drops the user at the top of the document and
     * their keyboard session is over.
     */
    useEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const scrollLock = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const focus = window.requestAnimationFrame(() => inputRef.current?.focus());

        return () => {
            window.cancelAnimationFrame(focus);
            document.body.style.overflow = scrollLock;
            previous?.focus();
        };
    }, []);

    useEffect(() => {
        if (activeCommand === undefined) return;
        rowRefs.current.get(activeCommand.id)?.scrollIntoView({ block: 'nearest' });
    }, [activeCommand]);

    const run = (command: Command) => {
        if (command.disabled === true) return;
        onClose();
        command.run();
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const last = selectable.length - 1;

        switch (event.key) {
            case 'Escape':
                event.preventDefault();
                onClose();
                return;
            case 'ArrowDown':
                event.preventDefault();
                setActive((current) => (last < 0 ? 0 : current >= last ? 0 : current + 1));
                return;
            case 'ArrowUp':
                event.preventDefault();
                setActive((current) => (last < 0 ? 0 : current <= 0 ? last : current - 1));
                return;
            case 'Home':
                event.preventDefault();
                setActive(0);
                return;
            case 'End':
                event.preventDefault();
                setActive(Math.max(last, 0));
                return;
            case 'Enter':
                event.preventDefault();
                if (activeCommand !== undefined) run(activeCommand);
                return;
            case 'Tab':
                // The search field is the only focus stop in here, so trapping
                // is a matter of refusing to leave it rather than cycling a ring.
                event.preventDefault();
                return;
            default:
        }
    };

    return (
        <motion.div
            className="fixed inset-0 z-[120] flex items-start justify-center px-4 pt-[12vh]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
        >
            <div
                aria-hidden
                onMouseDown={onClose}
                className="absolute inset-0 bg-background/60 backdrop-blur-[3px]"
            />

            <motion.div
                role="dialog"
                aria-modal="true"
                aria-label="Command palette"
                onKeyDown={onKeyDown}
                initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.985 }}
                transition={transition}
                className="panel-surface relative flex max-h-[min(30rem,70vh)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border-strong shadow-[var(--shadow-panel)]"
            >
                <div className="flex items-center gap-3 border-b border-border-subtle px-4">
                    <Search size={16} className="shrink-0 text-text-muted" aria-hidden />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            // A new search means a new best match, so selection
                            // returns to the top rather than to whatever row the
                            // previous query happened to leave it on.
                            setActive(0);
                        }}
                        placeholder="Search commands"
                        spellCheck={false}
                        autoComplete="off"
                        role="combobox"
                        aria-expanded="true"
                        aria-controls={listId}
                        aria-autocomplete="list"
                        aria-label="Search commands"
                        aria-activedescendant={
                            activeCommand === undefined ? undefined : rowId(activeCommand.id)
                        }
                        className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none"
                    />
                    <kbd className="hidden shrink-0 rounded border border-border-subtle px-1.5 py-0.5 font-mono text-[10px] text-text-muted sm:block">
                        esc
                    </kbd>
                </div>

                <div
                    id={listId}
                    role="listbox"
                    aria-label="Commands"
                    className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
                >
                    {groups.length === 0 ? (
                        <p className="px-3 py-10 text-center text-[13px] leading-relaxed text-text-muted">
                            Nothing matches {'“'}
                            <span className="text-text-secondary">{query.trim()}</span>
                            {'”'}. Try a shorter word.
                        </p>
                    ) : (
                        groups.map((group) => {
                            const headingId = `${baseId}-group-${group.name}`;
                            return (
                                <div key={group.name} role="group" aria-labelledby={headingId}>
                                    <div
                                        id={headingId}
                                        className="sticky top-0 z-10 bg-surface-raised px-3 pb-1.5 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-muted"
                                    >
                                        {group.name}
                                    </div>

                                    {group.commands.map((command) => {
                                        const isDisabled = command.disabled === true;
                                        const isActive =
                                            activeCommand !== undefined && activeCommand.id === command.id;

                                        return (
                                            <div
                                                key={command.id}
                                                id={rowId(command.id)}
                                                role="option"
                                                aria-selected={isActive}
                                                aria-disabled={isDisabled || undefined}
                                                ref={(node) => {
                                                    if (node === null) rowRefs.current.delete(command.id);
                                                    else rowRefs.current.set(command.id, node);
                                                }}
                                                onMouseMove={() => {
                                                    if (isDisabled) return;
                                                    const index = selectable.findIndex(
                                                        (candidate) => candidate.id === command.id,
                                                    );
                                                    if (index !== -1) setActive(index);
                                                }}
                                                // Keeps the search field focused, so
                                                // aria-activedescendant stays the single
                                                // source of truth for what is selected.
                                                onMouseDown={(event) => event.preventDefault()}
                                                onClick={() => run(command)}
                                                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors duration-100 ${
                                                    isDisabled
                                                        ? 'cursor-not-allowed text-text-muted/70'
                                                        : isActive
                                                          ? 'cursor-pointer bg-accent-soft text-text-primary'
                                                          : 'cursor-pointer text-text-secondary'
                                                }`}
                                            >
                                                <span
                                                    aria-hidden
                                                    className={`flex h-4 w-4 shrink-0 items-center justify-center ${
                                                        isActive && !isDisabled ? 'text-accent' : 'text-text-muted'
                                                    }`}
                                                >
                                                    {command.icon}
                                                </span>

                                                <span className="min-w-0 flex-1 truncate">{command.label}</span>

                                                {command.hint !== undefined && (
                                                    <span className="shrink-0 font-mono text-[11px] text-text-muted">
                                                        {command.hint}
                                                    </span>
                                                )}

                                                {isActive && !isDisabled && (
                                                    <CornerDownLeft
                                                        size={13}
                                                        aria-hidden
                                                        className="shrink-0 text-accent"
                                                    />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })
                    )}
                </div>

                <div className="flex items-center gap-4 border-t border-border-subtle px-4 py-2.5 text-[11px] text-text-muted">
                    <span className="flex items-center gap-1.5">
                        <kbd className="rounded border border-border-subtle px-1 font-mono">{'↑'}</kbd>
                        <kbd className="rounded border border-border-subtle px-1 font-mono">{'↓'}</kbd>
                        to move
                    </span>
                    <span className="flex items-center gap-1.5">
                        <kbd className="rounded border border-border-subtle px-1 font-mono">{'↵'}</kbd>
                        to run
                    </span>
                    <span className="ml-auto tabular-nums">
                        {selectable.length} command{selectable.length === 1 ? '' : 's'}
                    </span>
                </div>
            </motion.div>
        </motion.div>
    );
}
