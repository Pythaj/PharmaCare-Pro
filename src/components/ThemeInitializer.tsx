'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/stores/app-store';
import type { AccentTheme } from '@/stores/app-store';

const THEME_STORAGE_KEY = 'pharmacare_accent_theme';

const themes: Record<string, Record<string, string>> = {
  emerald: {
    '--accent-50': '#ecfdf5', '--accent-100': '#d1fae5', '--accent-200': '#a7f3d0',
    '--accent-500': '#10b981', '--accent-600': '#059669', '--accent-700': '#047857',
    '--accent-primary': '#059669', '--accent-primary-hover': '#047857',
    '--accent-primary-light': '#d1fae5', '--accent-primary-muted': 'rgba(16,185,129,0.15)',
    '--accent-primary-foreground': '#047857', '--accent-primary-fg-dark': '#34d399',
    '--accent-primary-dot': '#34d399', '--accent-primary-border': 'rgba(16,185,129,0.3)',
    '--accent-gradient-from': '#059669', '--accent-gradient-via': '#10b981',
    '--accent-gradient-to': '#0d9488', '--accent-secondary': '#0d9488',
  },
  blue: {
    '--accent-50': '#eff6ff', '--accent-100': '#dbeafe', '--accent-200': '#bfdbfe',
    '--accent-500': '#3b82f6', '--accent-600': '#2563eb', '--accent-700': '#1d4ed8',
    '--accent-primary': '#2563eb', '--accent-primary-hover': '#1d4ed8',
    '--accent-primary-light': '#dbeafe', '--accent-primary-muted': 'rgba(59,130,246,0.15)',
    '--accent-primary-foreground': '#1d4ed8', '--accent-primary-fg-dark': '#60a5fa',
    '--accent-primary-dot': '#60a5fa', '--accent-primary-border': 'rgba(59,130,246,0.3)',
    '--accent-gradient-from': '#2563eb', '--accent-gradient-via': '#3b82f6',
    '--accent-gradient-to': '#1e40af', '--accent-secondary': '#1e40af',
  },
  violet: {
    '--accent-50': '#f5f3ff', '--accent-100': '#ede9fe', '--accent-200': '#ddd6fe',
    '--accent-500': '#8b5cf6', '--accent-600': '#7c3aed', '--accent-700': '#6d28d9',
    '--accent-primary': '#7c3aed', '--accent-primary-hover': '#6d28d9',
    '--accent-primary-light': '#ede9fe', '--accent-primary-muted': 'rgba(139,92,246,0.15)',
    '--accent-primary-foreground': '#6d28d9', '--accent-primary-fg-dark': '#a78bfa',
    '--accent-primary-dot': '#a78bfa', '--accent-primary-border': 'rgba(139,92,246,0.3)',
    '--accent-gradient-from': '#7c3aed', '--accent-gradient-via': '#8b5cf6',
    '--accent-gradient-to': '#6d28d9', '--accent-secondary': '#6d28d9',
  },
  rose: {
    '--accent-50': '#fff1f2', '--accent-100': '#ffe4e6', '--accent-200': '#fecdd3',
    '--accent-500': '#f43f5e', '--accent-600': '#e11d48', '--accent-700': '#be123c',
    '--accent-primary': '#e11d48', '--accent-primary-hover': '#be123c',
    '--accent-primary-light': '#ffe4e6', '--accent-primary-muted': 'rgba(244,63,94,0.15)',
    '--accent-primary-foreground': '#be123c', '--accent-primary-fg-dark': '#fb7185',
    '--accent-primary-dot': '#fb7185', '--accent-primary-border': 'rgba(244,63,94,0.3)',
    '--accent-gradient-from': '#e11d48', '--accent-gradient-via': '#f43f5e',
    '--accent-gradient-to': '#be123c', '--accent-secondary': '#be123c',
  },
  amber: {
    '--accent-50': '#fffbeb', '--accent-100': '#fef3c7', '--accent-200': '#fde68a',
    '--accent-500': '#f59e0b', '--accent-600': '#d97706', '--accent-700': '#b45309',
    '--accent-primary': '#d97706', '--accent-primary-hover': '#b45309',
    '--accent-primary-light': '#fef3c7', '--accent-primary-muted': 'rgba(245,158,11,0.15)',
    '--accent-primary-foreground': '#b45309', '--accent-primary-fg-dark': '#fbbf24',
    '--accent-primary-dot': '#fbbf24', '--accent-primary-border': 'rgba(245,158,11,0.3)',
    '--accent-gradient-from': '#d97706', '--accent-gradient-via': '#f59e0b',
    '--accent-gradient-to': '#b45309', '--accent-secondary': '#b45309',
  },
  teal: {
    '--accent-50': '#f0fdfa', '--accent-100': '#ccfbf1', '--accent-200': '#99f6e4',
    '--accent-500': '#14b8a6', '--accent-600': '#0d9488', '--accent-700': '#0f766e',
    '--accent-primary': '#0d9488', '--accent-primary-hover': '#0f766e',
    '--accent-primary-light': '#ccfbf1', '--accent-primary-muted': 'rgba(20,184,166,0.15)',
    '--accent-primary-foreground': '#0f766e', '--accent-primary-fg-dark': '#2dd4bf',
    '--accent-primary-dot': '#2dd4bf', '--accent-primary-border': 'rgba(20,184,166,0.3)',
    '--accent-gradient-from': '#0d9488', '--accent-gradient-via': '#14b8a6',
    '--accent-gradient-to': '#0f766e', '--accent-secondary': '#0f766e',
  },
};

const VALID_THEMES = ['emerald', 'blue', 'violet', 'rose', 'amber', 'teal'];

function applyThemeVars(theme: string) {
  const vars = themes[theme];
  if (!vars) return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
  root.setAttribute('data-accent', theme);
}

/**
 * ThemeInitializer — renders nothing; synchronizes theme from
 * localStorage → Zustand → CSS variables on app mount.
 *
 * Also persists theme changes from Zustand back to localStorage.
 */
export function ThemeInitializer() {
  const accentTheme = useAppStore((s) => s.accentTheme);

  // Load saved theme from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved && VALID_THEMES.includes(saved)) {
      useAppStore.getState().setAccentTheme(saved as AccentTheme);
    } else {
      applyThemeVars(accentTheme);
    }
  }, []);

  // Apply CSS vars whenever theme changes
  useEffect(() => {
    applyThemeVars(accentTheme);
    localStorage.setItem(THEME_STORAGE_KEY, accentTheme);
  }, [accentTheme]);

  return null;
}
