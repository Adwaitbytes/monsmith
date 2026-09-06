"use client";

import { useEffect } from "react";
import { useThemeStore } from "@/lib/store";

/**
 * Mirrors the theme store onto <html data-theme>, which is what the CSS tokens
 * in globals.css key off. Keeping the source of truth in one store and the
 * application in one place stops panels from drifting out of sync with the
 * rest of the interface.
 */
export function ThemeSync() {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  // A visitor who has never chosen gets the operating system's preference
  // rather than the store's hard-coded default. Only on a genuine first visit:
  // once anything is persisted, that is the choice and it stands.
  useEffect(() => {
    try {
      if (localStorage.getItem("monsmith-theme") !== null) return;
      if (!window.matchMedia) return;
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (prefersDark) setTheme("dark");
    } catch {
      // Storage can be unavailable in a partitioned iframe. The default stands.
    }
  }, [setTheme]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  return null;
}
