'use client';

import React from 'react';

/**
 * The vertical rail of tools, in the VS Code sense.
 *
 * The first attempt at fixing this studio removed capability, which was the
 * wrong lesson. The complaint was never that the product did too much. It was
 * that nine unlabelled icons sat in one horizontal row with nothing to tell
 * them apart, two of them sharing a glyph outright, so the eye had no way in.
 *
 * VS Code carries far more than we do and reads as calm, because every tool has
 * a lane. A vertical strip of large, visually distinct icons, each one a mode
 * rather than an action, each opening in the same place every time. You learn
 * one location and one gesture instead of hunting a toolbar.
 *
 * Distinctness is the load-bearing property here. Two tools that look alike are
 * worse than one tool, so every icon in this rail is a different shape rather
 * than a different label on the same shape, and each says what it is and what
 * key opens it on hover.
 */

export interface ActivityItem {
    id: string;
    label: string;
    icon: React.ReactNode;
    /** Shown in the tooltip, so the keyboard route is discoverable by hovering. */
    shortcut?: string;
    /** A count worth surfacing without opening the view, like unread problems. */
    badge?: number;
    /** Severity of the badge, so a critical count does not read as a total. */
    badgeTone?: 'neutral' | 'warn' | 'bad';
}

export interface ActivityBarProps {
    items: readonly ActivityItem[];
    /** The view currently occupying the side bar, or null when it is closed. */
    active: string | null;
    onSelect: (id: string) => void;
    /** Pinned to the bottom, away from the tools. Settings, account. */
    footer?: React.ReactNode;
}

const BADGE_TONES = {
    neutral: 'bg-accent text-white',
    warn: 'bg-amber-500 text-black',
    bad: 'bg-red-500 text-white',
} as const;

export function ActivityBar({ items, active, onSelect, footer }: ActivityBarProps) {
    return (
        <nav
            aria-label="Tools"
            className="flex w-12 shrink-0 flex-col items-center justify-between border-r border-border-subtle bg-surface-sunken py-2"
        >
            <ul className="flex flex-col items-center gap-1">
                {items.map((item) => {
                    const selected = active === item.id;
                    return (
                        <li key={item.id} className="relative">
                            <button
                                onClick={() => onSelect(item.id)}
                                aria-label={item.label}
                                aria-pressed={selected}
                                className={`group relative grid h-10 w-10 place-items-center rounded-lg outline-none ring-accent-line transition-colors focus-visible:ring-2 ${
                                    selected
                                        ? 'text-text-primary'
                                        : 'text-text-muted hover:text-text-secondary'
                                }`}
                            >
                                {/*
                                  The active marker is a bar on the edge rather
                                  than a filled background. A filled square in a
                                  narrow rail reads as a button being pressed;
                                  the bar reads as "this view is open", which is
                                  what it actually means.
                                */}
                                <span
                                    aria-hidden
                                    className={`absolute left-[-8px] top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r bg-accent transition-opacity motion-reduce:transition-none ${
                                        selected ? 'opacity-100' : 'opacity-0'
                                    }`}
                                />
                                {item.icon}

                                {item.badge !== undefined && item.badge > 0 && (
                                    <span
                                        className={`absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold tabular-nums ${
                                            BADGE_TONES[item.badgeTone ?? 'neutral']
                                        }`}
                                    >
                                        {item.badge > 99 ? '99+' : item.badge}
                                    </span>
                                )}

                                {/* Hover label, since an icon alone was the original fault. */}
                                <span
                                    role="tooltip"
                                    className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md border border-border-subtle bg-surface-overlay px-2 py-1 text-[11.5px] text-text-primary shadow-[var(--shadow-panel)] group-hover:block group-focus-visible:block"
                                >
                                    {item.label}
                                    {item.shortcut !== undefined && (
                                        <span className="ml-2 font-mono text-[10px] text-text-muted">
                                            {item.shortcut}
                                        </span>
                                    )}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>

            {footer !== undefined && <div className="flex flex-col items-center gap-1">{footer}</div>}
        </nav>
    );
}
