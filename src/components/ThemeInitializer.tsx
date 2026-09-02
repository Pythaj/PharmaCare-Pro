'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/stores/app-store';
import type { AccentTheme } from '@/stores/app-store';
import {
  applyThemeVars,
  VALID_ACCENT_THEMES,
} from '@/hooks/use-accent-theme';

const THEME_STORAGE_KEY = 'pharmacare_accent_theme';

/**
 * ThemeInitializer — renders nothing; synchronizes theme from
 * localStorage → Zustand → CSS variables on app mount.
 *
 * The CSS variable definitions live in `use-accent-theme` (single source
 * of truth). This component only handles the persistence plumbing.
 */
export function ThemeInitializer() {
  const accentTheme = useAppStore((s) => s.accentTheme);

  // Load saved theme from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved && VALID_ACCENT_THEMES.has(saved)) {
      useAppStore.getState().setAccentTheme(saved as AccentTheme);
    } else {
      applyThemeVars(accentTheme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply CSS vars whenever theme changes
  useEffect(() => {
    applyThemeVars(accentTheme);
    localStorage.setItem(THEME_STORAGE_KEY, accentTheme);
  }, [accentTheme]);

  return null;
}