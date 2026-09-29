/**
 * Money formatting — the single source of truth for how a currency amount is
 * rendered.
 *
 * ## Why this module exists
 *
 * `formatGHS` was copy-pasted into ten components. Every copy was identical:
 *
 *     new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' })
 *
 * Identical today, but nothing kept them identical. The moment one view gained
 * a rounding rule, a minimum-amount threshold, or a different locale, the app
 * would show two different numbers for the same value depending on which screen
 * you happened to be looking at — and for a POS, a receipt total that disagrees
 * with the till total is a dispute, not a cosmetic bug.
 *
 * ## Why the formatter is cached
 *
 * `Intl.NumberFormat` construction is the expensive part of formatting, not the
 * call. `SalesHistoryView` alone renders dozens of amounts per table page, and
 * constructing a formatter per cell meant dozens of allocations per render. The
 * formatters are pure functions of their options, so one per distinct currency
 * is enough for the life of the tab.
 *
 * ## Currency
 *
 * `display.currency` in settings is a real, editable setting, so the currency is
 * never hardcoded to GHS. `money()` reads the configured value and
 * `formatMoney()` takes one explicitly. Both fall back to `'GHS'` — the cedi —
 * which is both the app's default and the correct answer when a stored setting
 * is missing, empty, or not a code `Intl` recognises.
 *
 * A malformed stored code must not throw. An unknown currency makes
 * `Intl.NumberFormat` raise a `RangeError`, and a formatting failure inside a
 * table cell would blank the whole screen. Unrecognised codes therefore fall
 * back to GHS rather than propagating.
 */

import { SETTINGS_STORAGE_KEY, type AllSettings } from '@/lib/app-settings';

/** The Ghanaian cedi — the pharmacy's default and universal fallback. */
export const DEFAULT_CURRENCY = 'GHS';

/** The locale paired with the cedi: `GHS 1,234.50`. */
const DEFAULT_LOCALE = 'en-GH';

/**
 * Cached formatters, keyed by currency code.
 *
 * A plain `Map` rather than a fixed array of every ISO code: the app supports a
 * handful of currencies in practice, and this stays correct if an admin sets a
 * code nobody anticipated.
 */
const formatterCache = new Map<string, Intl.NumberFormat>();

/**
 * True when `Intl` can actually format this currency code.
 *
 * Checked once per code and cached, because constructing a formatter to discover
 * it throws is exactly the failure being avoided.
 */
function isSupportedCurrency(code: string): boolean {
  try {
    // `resolvedOptions` forces the construction that would otherwise throw.
    new Intl.NumberFormat(DEFAULT_LOCALE, { style: 'currency', currency: code })
      .resolvedOptions();
    return true;
  } catch {
    return false;
  }
}

const supportCache = new Map<string, boolean>();

/**
 * Normalises a currency code to one `Intl` will accept, or `null` if unusable.
 *
 * Returns `null` rather than a fallback so the caller decides, keeping the
 * "unknown code means cedi" policy in exactly one place.
 */
function normaliseCurrency(code: string | null | undefined): string | null {
  // `toUpperCase` because settings are hand-editable and `ghs` is a very
  // plausible typo; ISO 4217 codes are conventionally uppercase.
  const trimmed = (code ?? '').trim().toUpperCase();
  if (!trimmed) return null;

  let supported = supportCache.get(trimmed);
  if (supported === undefined) {
    supported = isSupportedCurrency(trimmed);
    supportCache.set(trimmed, supported);
  }
  return supported ? trimmed : null;
}

/** Returns the cached formatter for `currency`, building it at most once. */
function getFormatter(currency: string): Intl.NumberFormat {
  let formatter = formatterCache.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(DEFAULT_LOCALE, { style: 'currency', currency });
    formatterCache.set(currency, formatter);
  }
  return formatter;
}

/**
 * Formats a monetary amount for display.
 *
 * @param value    The amount. Non-finite values (`NaN`, `Infinity`) render as
 *                 the cedi zero rather than `GHS NaN`, which is what a
 *                 `toLocaleString` call on a bad total produces and what a
 *                 reconciliation screen must never show.
 * @param currency ISO 4217 code. Defaults to the cedi; an unsupported code
 *                 silently falls back to the cedi instead of throwing.
 */
export function formatMoney(value: number, currency: string = DEFAULT_CURRENCY): string {
  const amount = Number.isFinite(value) ? value : 0;
  return getFormatter(normaliseCurrency(currency) ?? DEFAULT_CURRENCY).format(amount);
}

/**
 * The currency the pharmacy is configured to use, read from the cached
 * settings.
 *
 * Read imperatively rather than through a hook because the majority of call
 * sites live in presentational subcomponents (`ProductRow`, `SaleRow`,
 * `ProfileDialog`, the print/PDF templates) that receive no settings prop.
 * Threading a hook or a formatter prop through all of them would be a wide,
 * easy-to-miss refactor across ten files, and a single missed prop would
 * silently render that one amount in the cedi while its neighbours followed the
 * setting — a worse outcome than reading the value in one place.
 *
 * Returns the cedi whenever no settings have been loaded yet, which is the
 * correct default rather than a placeholder.
 */
export function configuredCurrency(): string {
  if (typeof window === 'undefined') return DEFAULT_CURRENCY;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_CURRENCY;
    const parsed = JSON.parse(raw) as Partial<AllSettings> | null;
    return parsed?.display?.currency ?? DEFAULT_CURRENCY;
  } catch {
    // Unavailable or corrupt cache — the default is always safe to render.
    return DEFAULT_CURRENCY;
  }
}

/**
 * `formatMoney` bound to the pharmacy's configured currency.
 *
 * The function to reach for in components. Pass the currency explicitly only
 * where a specific one is genuinely required.
 */
export function money(value: number): string {
  return formatMoney(value, configuredCurrency());
}
