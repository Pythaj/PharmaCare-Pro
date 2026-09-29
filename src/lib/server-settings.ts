/**
 * Server-side reads of `SystemSetting` — the counterpart to the client-side
 * `usePharmacySettings` hook (Rule 18: one source of truth, two access paths
 * because the two runtimes genuinely cannot share one).
 *
 * ## Why this exists
 *
 * A dozen settings are editable in the Settings screen, stored, and then read by
 * nobody — the code hardcodes the same value the owner configured. `lowStock-
 * Threshold` and `expiryAlertDays` are the clearest cases: the owner sets "warn
 * me 14 days before expiry" and every alert still fires at the hardcoded 90.
 * Worse, the screen is not wrong-looking — it shows the saved value, so there is
 * no way to tell from the UI that it does nothing.
 *
 * The reason is structural: settings live in the database, and the alert
 * classification runs inside API route handlers. A client-side hook cannot reach
 * it. These helpers are the server-side read path that closes the gap.
 *
 * ## Shape
 *
 * Every value is stored as a string in a flat key/value table, so each read
 * parses defensively and falls back to the shared default on anything
 * unexpected. A settings row that is corrupt, blank, or hand-edited to `abc`
 * must degrade to the documented default rather than turning a request into a
 * 500 or, worse, silently misclassifying stock.
 */

import { db } from '@/lib/db';
import { defaultSettings } from '@/lib/app-settings';
import { RETIRED_SETTING_KEYS } from '@/lib/settings-visibility';

/**
 * Reads a numeric setting, falling back when absent or unparseable.
 *
 * Rejects non-finite results explicitly: `Number('')` is `0` and
 * `Number(' ')` is `0`, so a blank cell would otherwise read as a real 0
 * threshold rather than as missing configuration.
 */
async function readNumber(key: string, fallback: number): Promise<number> {
  const row = await db.systemSetting.findUnique({ where: { key }, select: { value: true } });
  if (!row) return fallback;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Reads a string setting, falling back when absent or blank. */
async function readString(key: string, fallback: string): Promise<string> {
  const row = await db.systemSetting.findUnique({ where: { key }, select: { value: true } });
  const value = row?.value?.trim();
  return value ? value : fallback;
}

/** Reads a boolean setting. Anything other than the literal `true` is false. */
async function readBoolean(key: string, fallback: boolean): Promise<boolean> {
  const row = await db.systemSetting.findUnique({ where: { key }, select: { value: true } });
  if (!row) return fallback;
  return row.value === 'true';
}

/** Days ahead of expiry that count as "expiring soon" (`notifications.expiryAlertDays`). */
export async function getExpiryAlertDays(): Promise<number> {
  const days = await readNumber(
    'notifications.expiryAlertDays',
    defaultSettings.notifications.expiryAlertDays
  );
  return days > 0 ? Math.floor(days) : 1;
}

/** Default payment method preselected at the till (`pos.defaultPaymentMethod`). */
export async function getDefaultPaymentMethod(): Promise<string> {
  return readString('pos.defaultPaymentMethod', defaultSettings.pos.defaultPaymentMethod);
}

/** Whether a sale may be completed without a customer (`pos.requireCustomer`). */
export async function getRequireCustomer(): Promise<boolean> {
  return readBoolean('pos.requireCustomer', defaultSettings.pos.requireCustomer);
}

/** Maximum cart lines allowed before the sale is rejected (`pos.maxLineItems`). */
export async function getMaxLineItems(): Promise<number> {
  const max = await readNumber('pos.maxLineItems', defaultSettings.pos.maxLineItems);
  return max > 0 ? Math.floor(max) : 1;
}

/**
 * Deletes setting rows whose feature has been removed from the app.
 *
 * ## Why a purge rather than a migration
 *
 * `SystemSetting` is generic key/value storage, so removing a feature leaves its
 * rows behind in every database that was ever seeded. A Prisma migration is the
 * usual answer, but this project ships two providers behind `db:push` and the
 * affected rows are data, not schema — the owner may well have edited
 * `pharmacy.taxRate` to a value that is only meaningful in their head. Deleting
 * them on read keeps both providers consistent and makes the cleanup happen on
 * the install that actually has the stale rows, instead of requiring a
 * hand-written migration to be run against each.
 *
 * This is called from the admin settings read. It is a write on a read path, so
 * two things keep it cheap and safe:
 *
 *  - It is admin-only. A salesperson hitting the POS must not issue a DELETE on
 *    every request just because a row nobody reads is still present.
 *  - Once the rows are gone the statement matches nothing and costs one indexed
 *    probe against a table that holds a few dozen rows. It is not a migration
 *    replayed per request, and there is nothing to lock.
 *
 * A failure is swallowed deliberately: a stale, unread key is a cosmetic
 * problem, and turning a transient database hiccup on this path into a failed
 * `/api/settings` would break the POS receipt for something nobody can observe.
 *
 * @returns the number of rows removed (0 once the install is clean)
 */
export async function purgeRetiredSettings(): Promise<number> {
  try {
    const { count } = await db.systemSetting.deleteMany({
      where: { key: { in: [...RETIRED_SETTING_KEYS] } },
    });
    return count;
  } catch (error) {
    console.error('[purgeRetiredSettings]', error);
    return 0;
  }
}
