'use client';

import { useEffect, useCallback } from 'react';
import { useAppStore } from '@/stores/app-store';

// ─── Theme Definitions ─────────────────────────────────────────
// Each theme provides CSS custom properties used across the app.
// Tailwind can't use CSS vars directly in class names (e.g., bg-[var(--accent-500)])
// so we apply the vars to :root and reference them in components via style props
// or utility classes like `bg-[var(--accent-bg)]` or `text-[var(--accent-fg)]`.

export type AccentTheme = 'emerald' | 'blue' | 'violet' | 'rose' | 'amber' | 'teal';

interface ThemeColors {
  // 50-100 scale for backgrounds
  50: string;
  100: string;
  200: string;
  500: string;
  600: string;
  700: string;
  // Semantic aliases used by components
  primary: string;       // 600 — main accent
  primaryHover: string;  // 700 — hover state
  primaryLight: string;  // 100 — light backgrounds
  primaryMuted: string;  // 500/15 — sidebar active bg
  primaryForeground: string; // 400/600 — text on dark/white bg
  primaryForegroundOnDark: string; // 400 — text on dark sidebar
  primaryDot: string;    // 400 — active indicator dots
  primaryBorder: string; // 500/30 — border accents
  gradientFrom: string;  // gradient start (600)
  gradientVia: string;   // gradient mid (500)
  gradientTo: string;    // gradient end (secondary)
  secondary: string;     // secondary brand color (teal/blue variant)
}

const themes: Record<AccentTheme, ThemeColors> = {
  emerald: {
    50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 500: '#10b981', 600: '#059669', 700: '#047857',
    primary: '#059669', primaryHover: '#047857', primaryLight: '#d1fae5',
    primaryMuted: 'rgba(16,185,129,0.15)', primaryForeground: '#047857',
    primaryForegroundOnDark: '#34d399', primaryDot: '#34d399',
    primaryBorder: 'rgba(16,185,129,0.3)',
    gradientFrom: '#059669', gradientVia: '#10b981', gradientTo: '#0d9488',
    secondary: '#0d9488',
  },
  blue: {
    50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8',
    primary: '#2563eb', primaryHover: '#1d4ed8', primaryLight: '#dbeafe',
    primaryMuted: 'rgba(59,130,246,0.15)', primaryForeground: '#1d4ed8',
    primaryForegroundOnDark: '#60a5fa', primaryDot: '#60a5fa',
    primaryBorder: 'rgba(59,130,246,0.3)',
    gradientFrom: '#2563eb', gradientVia: '#3b82f6', gradientTo: '#1e40af',
    secondary: '#1e40af',
  },
  violet: {
    50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9',
    primary: '#7c3aed', primaryHover: '#6d28d9', primaryLight: '#ede9fe',
    primaryMuted: 'rgba(139,92,246,0.15)', primaryForeground: '#6d28d9',
    primaryForegroundOnDark: '#a78bfa', primaryDot: '#a78bfa',
    primaryBorder: 'rgba(139,92,246,0.3)',
    gradientFrom: '#7c3aed', gradientVia: '#8b5cf6', gradientTo: '#6d28d9',
    secondary: '#6d28d9',
  },
  rose: {
    50: '#fff1f2', 100: '#ffe4e6', 200: '#fecdd3', 500: '#f43f5e', 600: '#e11d48', 700: '#be123c',
    primary: '#e11d48', primaryHover: '#be123c', primaryLight: '#ffe4e6',
    primaryMuted: 'rgba(244,63,94,0.15)', primaryForeground: '#be123c',
    primaryForegroundOnDark: '#fb7185', primaryDot: '#fb7185',
    primaryBorder: 'rgba(244,63,94,0.3)',
    gradientFrom: '#e11d48', gradientVia: '#f43f5e', gradientTo: '#be123c',
    secondary: '#be123c',
  },
  amber: {
    50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 500: '#f59e0b', 600: '#d97706', 700: '#b45309',
    primary: '#d97706', primaryHover: '#b45309', primaryLight: '#fef3c7',
    primaryMuted: 'rgba(245,158,11,0.15)', primaryForeground: '#b45309',
    primaryForegroundOnDark: '#fbbf24', primaryDot: '#fbbf24',
    primaryBorder: 'rgba(245,158,11,0.3)',
    gradientFrom: '#d97706', gradientVia: '#f59e0b', gradientTo: '#b45309',
    secondary: '#b45309',
  },
  teal: {
    50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 500: '#14b8a6', 600: '#0d9488', 700: '#0f766e',
    primary: '#0d9488', primaryHover: '#0f766e', primaryLight: '#ccfbf1',
    primaryMuted: 'rgba(20,184,166,0.15)', primaryForeground: '#0f766e',
    primaryForegroundOnDark: '#2dd4bf', primaryDot: '#2dd4bf',
    primaryBorder: 'rgba(20,184,166,0.3)',
    gradientFrom: '#0d9488', gradientVia: '#14b8a6', gradientTo: '#0f766e',
    secondary: '#0f766e',
  },
};

// Swatch info for the settings page
export const THEME_SWATCHES = [
  { name: 'Emerald', value: 'emerald' as const, className: 'bg-emerald-500', preview: '#10b981' },
  { name: 'Blue', value: 'blue' as const, className: 'bg-blue-500', preview: '#3b82f6' },
  { name: 'Violet', value: 'violet' as const, className: 'bg-violet-500', preview: '#8b5cf6' },
  { name: 'Rose', value: 'rose' as const, className: 'bg-rose-500', preview: '#f43f5e' },
  { name: 'Amber', value: 'amber' as const, className: 'bg-amber-500', preview: '#f59e0b' },
  { name: 'Teal', value: 'teal' as const, className: 'bg-teal-500', preview: '#14b8a6' },
];

// ─── Hook ───────────────────────────────────────────────────────

/**
 * useAccentTheme
 *
 * Reads/writes the accent theme from the Zustand store and applies
 * CSS custom properties to :root so every component can reference them.
 *
 * Usage:
 *   const { theme, setTheme } = useAccentTheme();
 *   // theme: 'emerald' | 'blue' | 'violet' | 'rose' | 'amber' | 'teal'
 *   // setTheme('blue') — instantly updates all accent colors app-wide
 *
 * In components, use inline styles:
 *   <div style={{ backgroundColor: 'var(--accent-primary)' }}>
 *
 * Or Tailwind arbitrary values:
 *   <div className="bg-[var(--accent-primary-light)]">
 *   <div className="text-[var(--accent-primary-foreground)]">
 */
export function useAccentTheme() {
  const accentTheme = useAppStore((s) => s.accentTheme);
  const setAccentTheme = useAppStore((s) => s.setAccentTheme);

  // Apply CSS variables to :root whenever theme changes
  useEffect(() => {
    const colors = themes[accentTheme] ?? themes.emerald;
    const root = document.documentElement;

    root.style.setProperty('--accent-50', colors[50]);
    root.style.setProperty('--accent-100', colors[100]);
    root.style.setProperty('--accent-200', colors[200]);
    root.style.setProperty('--accent-500', colors[500]);
    root.style.setProperty('--accent-600', colors[600]);
    root.style.setProperty('--accent-700', colors[700]);
    root.style.setProperty('--accent-primary', colors.primary);
    root.style.setProperty('--accent-primary-hover', colors.primaryHover);
    root.style.setProperty('--accent-primary-light', colors.primaryLight);
    root.style.setProperty('--accent-primary-muted', colors.primaryMuted);
    root.style.setProperty('--accent-primary-foreground', colors.primaryForeground);
    root.style.setProperty('--accent-primary-fg-dark', colors.primaryForegroundOnDark);
    root.style.setProperty('--accent-primary-dot', colors.primaryDot);
    root.style.setProperty('--accent-primary-border', colors.primaryBorder);
    root.style.setProperty('--accent-gradient-from', colors.gradientFrom);
    root.style.setProperty('--accent-gradient-via', colors.gradientVia);
    root.style.setProperty('--accent-gradient-to', colors.gradientTo);
    root.style.setProperty('--accent-secondary', colors.secondary);

    // Also set a data attribute for Tailwind-aware theme matching
    root.setAttribute('data-accent', accentTheme);
  }, [accentTheme]);

  const setTheme = useCallback(
    (theme: AccentTheme) => {
      setAccentTheme(theme);
    },
    [setAccentTheme]
  );

  return { theme: accentTheme, setTheme, themes, THEME_SWATCHES };
}

/**
 * Convenience: returns the current theme object directly.
 */
export function getThemeColors(theme: AccentTheme): ThemeColors {
  return themes[theme] ?? themes.emerald;
}
