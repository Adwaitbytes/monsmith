'use client';

import React from 'react';
import { Moon, Sun } from 'lucide-react';

import { useThemeStore } from '@/lib/store';
import { useHydrated } from '@/lib/useHydrated';

/**
 * The light/dark switch.
 *
 * Extracted so every page can carry one. The landing page and the studio had
 * their own, which meant /compare, /share and /admin rendered in whatever theme
 * happened to be stored and gave the reader no way to change it. A shared page
 * with no way out of the wrong theme is worse than one with no theme at all.
 *
 * Renders a placeholder until hydration, because the stored theme is not known
 * during server rendering and swapping the icon after paint reads as a glitch.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
    const { theme, toggleTheme } = useThemeStore();
    const mounted = useHydrated();

    return (
        <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className={`grid h-8 w-8 place-items-center rounded-lg border border-border-subtle text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary ${className}`}
        >
            {mounted && theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
    );
}
