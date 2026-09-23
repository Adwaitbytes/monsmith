'use client';

import { useEffect } from 'react';

/**
 * Keyboard shortcuts, declared once.
 *
 * The activity bar was already advertising one of these in a tooltip before
 * anything bound it, which is the same fault as an icon that looks like a
 * button and does nothing: the interface made a promise the code did not keep.
 * A shortcut is either bound or it is not claimed.
 *
 * The bindings follow VS Code, because that is where the muscle memory comes
 * from. Someone who reaches for the explorer toggle will press the key they
 * already press, and a studio that answers that key is one less thing to learn.
 *
 * Nothing fires while a text field has focus, except the combinations that
 * deliberately include a modifier people never type into prose. Stealing a
 * plain keystroke from someone mid-sentence is worse than not having the
 * shortcut at all.
 */

export interface Shortcut {
    /** Lowercase key, as `KeyboardEvent.key` reports it. */
    key: string;
    /** Command on a Mac, Control elsewhere. */
    mod?: boolean;
    shift?: boolean;
    run: () => void;
}

function typingInto(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useShortcuts(shortcuts: readonly Shortcut[]): void {
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const mod = event.metaKey || event.ctrlKey;

            for (const shortcut of shortcuts) {
                if (event.key.toLowerCase() !== shortcut.key) continue;
                if ((shortcut.mod ?? false) !== mod) continue;
                if ((shortcut.shift ?? false) !== event.shiftKey) continue;

                // A modified combination is safe to take from a text field;
                // an unmodified one is somebody's next character.
                if (!(shortcut.mod ?? false) && typingInto(event.target)) continue;

                event.preventDefault();
                shortcut.run();
                return;
            }
        };

        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [shortcuts]);
}
