'use client';

/**
 * Read-side hook for application settings.
 *
 * Source of truth is the SystemSetting table via GET /api/settings;
 * a localStorage mirror (SETTINGS_STORAGE_KEY) provides instant offline
 * reads and is written through on every successful fetch. Consumers such
 * as POSView use this for VAT rate, receipt branding and behaviour flags.
 *
 * The API call is memoized at module level so mounting many consumers
 * (POS, SalesHistory, the app shell) results in a single /api/settings
 * round-trip per tab session instead of one fetch per mounted view.
 */

import { useEffect, useState } from 'react';
import {
  type AllSettings,
  defaultSettings,
  SETTINGS_STORAGE_KEY,
  unflattenSettings,
} from '@/lib/app-settings';

function readCached(): AllSettings {
  if (typeof window === 'undefined') return defaultSettings;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return mergeSettings(parsed);
    }
  } catch {
    // Corrupt cache falls through to defaults
  }
  return defaultSettings;
}

/** Shallow-merges stored/partial sections over the defaults so no key is lost. */
function mergeSettings(partial: Partial<AllSettings> | null | undefined): AllSettings {
  const merged = { ...defaultSettings } as AllSettings;
  if (!partial) return merged;
  for (const key of Object.keys(defaultSettings) as (keyof AllSettings)[]) {
    merged[key] = { ...defaultSettings[key], ...((partial[key] ?? {}) as object) } as never;
  }
  return merged;
}

let settingsPromise: Promise<AllSettings | null> | null = null;

/**
 * Fetches the latest settings once per session — the promise is shared, so
 * concurrent callers (multiple views mounting at once) dedupe into a single
 * request. Returns null when the API is unreachable so the caller can keep
 * its localStorage cache/defaults.
 */
export function fetchLatestSettings(): Promise<AllSettings | null> {
  if (settingsPromise) return settingsPromise;
  settingsPromise = (async () => {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return null;
      const data = await res.json();
      const flat: Record<string, string> = data.settings ?? {};
      if (Object.keys(flat).length === 0) return null;
      return mergeSettings(unflattenSettings(flat));
    } catch {
      return null;
    }
  })().finally(() => {
    // Allow a later explicit refresh (e.g. after SettingsView saves) to refetch.
    settingsPromise = null;
  });
  return settingsPromise;
}

/** Drops the memoized settings promise so the next fetchLatestSettings() re-queries. */
export function invalidateSettingsCache() {
  settingsPromise = null;
}

export function usePharmacySettings(): { settings: AllSettings } {
  const [settings, setSettings] = useState<AllSettings>(readCached);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const merged = await fetchLatestSettings();
      if (!merged || cancelled) return;
      setSettings(merged);
      try {
        window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
      } catch {
        // Storage full / blocked — in-memory value still applies
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { settings };
}