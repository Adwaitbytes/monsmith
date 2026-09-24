'use client';

import React, { useCallback, useSyncExternalStore } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * The side panel's sections, all cut to the same shape.
 *
 * Three things live in this column and each had arrived with its own chrome: a
 * file tree that asked for the full height, a report list with a scroller of
 * its own, and an artifacts block that simply grew. Stacked, they produced a
 * panel with three headings in three type sizes, two scrollbars, and a
 * paragraph of explanatory text wedged between them. Nothing there was wrong on
 * its own, which is how a panel gets ugly without anybody breaking anything.
 *
 * So the section is the primitive rather than the contents. One header shape,
 * one chevron, one place the count sits, and one rule about which section is
 * allowed to grow. VS Code does this and it is why its explorer holds four
 * things without feeling full.
 *
 * Collapsed sections are remembered. Somebody who never looks at past reports
 * should close it once, not once per visit.
 */

const STORE_KEY = 'monsmith.sidepanel.closed';

const NONE: ReadonlySet<string> = new Set();

/*
  One store for every section, subscribed to rather than copied into state.

  Read into component state, this needed an effect to correct the server's
  guess after mount, and an effect that calls setState on every mount is both a
  lint error and a wasted render. An external store is what this actually is:
  one value, shared by three sections, that changes when somebody clicks a
  chevron.
*/
const listeners = new Set<() => void>();

/** Cached so `getSnapshot` returns the same reference until the value changes. */
let raw: string | null = null;
let parsed: ReadonlySet<string> = NONE;

function closedSections(): ReadonlySet<string> {
    let current: string | null;
    try {
        current = window.localStorage.getItem(STORE_KEY);
    } catch {
        // A blocked store costs a click, which is not worth failing over.
        return NONE;
    }

    if (current === raw) return parsed;
    raw = current;

    if (current === null) {
        parsed = NONE;
        return parsed;
    }
    try {
        const value: unknown = JSON.parse(current);
        parsed = Array.isArray(value)
            ? new Set(value.filter((entry): entry is string => typeof entry === 'string'))
            : NONE;
    } catch {
        parsed = NONE;
    }
    return parsed;
}

function subscribe(onChange: () => void): () => void {
    listeners.add(onChange);
    return () => {
        listeners.delete(onChange);
    };
}

// Sections start open in the HTML. Rendering one visitor's collapsed panel into
// a page the cache hands to everybody else is worse than a frame of correction.
const serverSnapshot = (): ReadonlySet<string> => NONE;

/** Whether a section is open, remembered under its id. */
export function useSection(id: string): [boolean, () => void] {
    const closed = useSyncExternalStore(subscribe, closedSections, serverSnapshot);

    const toggle = useCallback(() => {
        const next = new Set(closedSections());
        if (next.has(id)) next.delete(id);
        else next.add(id);

        try {
            window.localStorage.setItem(STORE_KEY, JSON.stringify([...next]));
        } catch {
            // Forgetting the choice is survivable; refusing to toggle is not.
        }
        // Storage events do not fire in the tab that wrote them.
        raw = null;
        for (const listener of listeners) listener();
    }, [id]);

    return [!closed.has(id), toggle];
}

export interface SectionHeaderProps {
    open: boolean;
    onToggle: () => void;
    title: string;
    /** Shown after the title, for lists where the size is the useful part. */
    count?: number | undefined;
    /** Buttons for the section, revealed on hover so the header stays quiet. */
    actions?: React.ReactNode;
}

export function SectionHeader({ open, onToggle, title, count, actions }: SectionHeaderProps) {
    return (
        <div className="group/header relative flex shrink-0 items-center gap-1 pl-1.5 pr-2">
            <button
                onClick={onToggle}
                aria-expanded={open}
                className="flex min-w-0 flex-1 items-center gap-1 rounded py-2 text-left outline-none ring-accent-line focus-visible:ring-2"
            >
                <ChevronDown
                    size={12}
                    aria-hidden
                    className={`shrink-0 text-text-muted transition-transform duration-150 motion-reduce:transition-none ${
                        open ? '' : '-rotate-90'
                    }`}
                />
                <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    {title}
                </span>
                {count !== undefined && count > 0 && (
                    <span className="shrink-0 text-[10.5px] tabular-nums text-text-muted/70">
                        {count}
                    </span>
                )}
            </button>

            {actions !== undefined && (
                /*
                  Hidden until the pointer or the keyboard arrives, and laid
                  over the header rather than inside it.

                  In the flow these took about ninety pixels of a two hundred
                  pixel column whether or not they were visible, which left the
                  heading rendering as "EXPLOR…". Invisible is not the same as
                  gone: they also still answered clicks, so a click on empty
                  header could create a file. Absolute plus `pointer-events`
                  fixes both, and `focus-within` keeps them reachable without a
                  mouse.
                */
                <span className="pointer-events-none absolute right-1.5 flex items-center gap-0.5 rounded-md bg-surface-raised pl-2 opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover/header:pointer-events-auto group-hover/header:opacity-100 motion-reduce:transition-none">
                    {actions}
                </span>
            )}
        </div>
    );
}

export interface SidePanelSectionProps extends SectionHeaderProps {
    /**
     * Takes the leftover height instead of sizing to its contents.
     *
     * Exactly one section in a column should set this, and only while open, or
     * the sections divide the space and every one of them gets a scrollbar.
     */
    grow?: boolean;
    children: React.ReactNode;
}

export function SidePanelSection({ grow = false, children, ...header }: SidePanelSectionProps) {
    const expanded = header.open;

    return (
        <section
            className={`flex min-h-0 flex-col border-b border-border-subtle last:border-b-0 ${
                expanded && grow ? 'min-h-0 flex-1' : 'shrink-0'
            }`}
        >
            <SectionHeader {...header} />
            {/*
              Hidden rather than unmounted.

              Collapsing threw the contents away, so reopening past reports
              re-fetched a list that had not changed and showed a spinner for
              it. A chevron is a request to look away, not to reload.

              The ceiling is for the same reason the growing section has none:
              forty stored reports under a file tree is a column you scroll
              past, and the tree is what somebody opened the panel for.
            */}
            <div
                className={`min-h-0 overflow-y-auto ${
                    expanded ? (grow ? 'flex-1' : 'max-h-56') : 'hidden'
                }`}
            >
                {children}
            </div>
        </section>
    );
}
