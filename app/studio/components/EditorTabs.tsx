'use client';

import React, { useEffect, useRef } from 'react';
import { FileCode, X } from 'lucide-react';

/**
 * Open files, as tabs.
 *
 * The studio showed one file at a time with no way back to the last one, which
 * is not a thing any editor does. Comparing two contracts, or reading an
 * interface while writing the thing that implements it, meant going back to the
 * tree and losing your place. A tab strip is not decoration on an editor; it is
 * the part that makes more than one file usable.
 *
 * Tabs open on the file you clicked and stay until closed, rather than the
 * preview-tab behaviour where a single click replaces whatever was there. That
 * behaviour is good in VS Code because its tree is browsed constantly; here the
 * tree is small and the surprise of a tab vanishing is worse than the clutter
 * of one extra.
 */

export interface EditorTab {
    path: string;
    name: string;
    /** Shown as a dot, in place of the close button, until saved. */
    dirty?: boolean;
}

export interface EditorTabsProps {
    tabs: readonly EditorTab[];
    activePath: string | null;
    onSelect: (path: string) => void;
    onClose: (path: string) => void;
}

export function EditorTabs({ tabs, activePath, onSelect, onClose }: EditorTabsProps) {
    const stripRef = useRef<HTMLDivElement>(null);

    // Switching files from the tree or the palette must bring that tab into
    // view, or the strip silently disagrees with the editor.
    useEffect(() => {
        if (activePath === null) return;
        const node = stripRef.current?.querySelector<HTMLElement>(
            `[data-path="${CSS.escape(activePath)}"]`,
        );
        node?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [activePath]);

    if (tabs.length === 0) return null;

    return (
        <div
            ref={stripRef}
            role="tablist"
            aria-label="Open files"
            className="scrollbar-hide flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border-subtle bg-surface-sunken"
        >
            {tabs.map((tab) => {
                const active = tab.path === activePath;
                return (
                    <div
                        key={tab.path}
                        data-path={tab.path}
                        role="tab"
                        aria-selected={active}
                        className={`group relative flex shrink-0 items-center gap-2 border-r border-border-subtle pl-3 pr-2 text-[12.5px] transition-colors ${
                            active
                                ? 'bg-surface-base text-text-primary'
                                : 'text-text-muted hover:bg-border-subtle/40 hover:text-text-secondary'
                        }`}
                    >
                        {/* Top rule marks the active tab, the way an editor does. */}
                        <span
                            aria-hidden
                            className={`absolute inset-x-0 top-0 h-[2px] bg-accent transition-opacity motion-reduce:transition-none ${
                                active ? 'opacity-100' : 'opacity-0'
                            }`}
                        />

                        <button
                            onClick={() => onSelect(tab.path)}
                            title={tab.path}
                            className="flex items-center gap-1.5 py-1 outline-none ring-accent-line focus-visible:ring-2"
                        >
                            <FileCode size={12} className="shrink-0 opacity-70" />
                            {tab.name}
                        </button>

                        <button
                            onClick={() => onClose(tab.path)}
                            aria-label={`Close ${tab.name}`}
                            className={`grid h-4 w-4 shrink-0 place-items-center rounded outline-none ring-accent-line transition-opacity hover:bg-border-strong focus-visible:ring-2 ${
                                active ? 'opacity-70' : 'opacity-0 group-hover:opacity-70'
                            }`}
                        >
                            {tab.dirty === true ? (
                                <span className="h-1.5 w-1.5 rounded-full bg-text-secondary" />
                            ) : (
                                <X size={11} />
                            )}
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
