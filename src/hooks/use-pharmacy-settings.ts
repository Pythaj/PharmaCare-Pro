'use client';

/**
 * Read-side hook for application settings.
 *
 * Source of truth is the SystemSetting table via GET /api/settings;
 * a localStorage mirror (SETTINGS_STORAGE_KEY) provides instant offline
 * reads and is written through on every successful fetch. Consumers such
 * as POSView use this for VAT rate, receipt branding and behaviour flags.
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

export function usePharmacySettings(): { settings: AllSettings } {
  const [settings, setSettings] = useState<AllSettings>(readCached);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const flat: Record<string, string> = data.settings ?? {};
        if (Object.keys(flat).length === 0) return;
        const merged = mergeSettings(unflattenSettings(flat));
        if (!cancelled) {
          setSettings(merged);
          window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
        }
      } catch {
        // Offline / API unavailable — cached values remain in use
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { settings };
}
