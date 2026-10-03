/**
 * Which system settings a given role is allowed to read (Rule 18).
 *
 * WHY THIS FILE EXISTS
 *
 * `SystemSetting` is a single flat key/value table, and most of it is harmless
 * business configuration: the pharmacy's name, the receipt
 * footer. Every signed-in user needs those, because the POS reads them to draw
 * the receipt. So `/api/settings` is a `requireAuth` route, not `requireAdmin`.
 *
 * That blanket rule was the problem. `remote.currentLink` lives in the same
 * table, and it holds the live public ngrok tunnel URL — the single string that,
 * if known, lets an outsider reach this installation from the internet. A
 * comment in `api/remote/link/route.ts` asserted that key was "kept out of the
 * public /api/settings feed", but the feed applied no filter at all, so every
 * salesperson received the tunnel URL. The comment described a protection that
 * did not exist, which is worse than no comment: it stopped anyone from
 * looking for the gap.
 *
 * THE RULE
 *
 * Access is decided by KEY PREFIX, not by an enumerated list of keys. An
 * allowlist of the secrets we remembered to think of would silently start
 * leaking the next one somebody adds. A prefix means anything filed under
 * `remote.` is owner-only by construction, including keys added later, and
 * there is no way to forget to protect one.
 *
 * The prefixes are plain strings and this module imports nothing, so the same
 * predicate is used by the API route and by any client that needs to explain
 * why a value came back missing.
 */

/**
 * Settings namespaces that only an ADMIN may read. Anything matching one of
 * these prefixes is withheld from a `sales` account.
 */
export const OWNER_ONLY_SETTING_PREFIXES = ['remote.'] as const;

/** True when a settings key may only be read by an admin. */
export function isOwnerOnlySettingKey(key: string): boolean {
  return OWNER_ONLY_SETTING_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Drops owner-only keys for a non-admin reader.
 *
 * @param settings flat key/value map as stored in `SystemSetting`
 * @param isAdmin  the caller's role; admins see everything
 */
export function visibleSettingsFor(
  settings: Record<string, string>,
  isAdmin: boolean
): Record<string, string> {
  if (isAdmin) return settings;

  const visible: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (isOwnerOnlySettingKey(key)) continue;
    visible[key] = value;
  }
  return visible;
}

/**
 * Setting keys that no longer exist and must never be served or stored again.
 *
 * ## Why a list is required here
 *
 * `SystemSetting` is a free-form key/value table, so removing a setting from the
 * code does not remove its row. The tax and discount feature was deleted from the
 * types, the UI, every calculation and both Prisma schemas, but any database
 * that had already been seeded still held `pharmacy.taxRate`,
 * `receipt.showTax`, `receipt.showDiscount` and `pos.defaultDiscount`.
 *
 * Those rows are inert — nothing reads them, and `mergeSettings` in
 * `use-pharmacy-settings.ts` only copies keys that still exist in
 * `defaultSettings`, so a stale localStorage mirror cannot resurrect them
 * either. Leaving them is not a correctness bug. It is a data-hygiene bug, and a
 * misleading one: the owner opens Settings, sees a value their app never uses,
 * and has no way to tell it apart from the settings that DO work.
 *
 * `purgeRetiredSettings` in `server-settings.ts` deletes the rows; this list is
 * the shared, client-safe definition of which keys qualify, so the read filter
 * and the delete can never disagree about what "retired" means.
 *
 * ## How to extend
 *
 * Add the key when a setting is removed from the app. Nothing in the app reads
 * this list, so a stale entry costs one harmless indexed DELETE; a MISSING entry
 * is what leaves a dead key in the owner's face.
 */
export const RETIRED_SETTING_KEYS = [
  'pharmacy.taxRate',
  'receipt.showTax',
  'receipt.showDiscount',
  'pos.defaultDiscount',
  'pharmacy.faviconUrl',
  'business.enableHours',
  'business.openTime',
  'business.closeTime',
  'business.closedDays',
  'data.autoBackup',
  'data.sessionTimeout',
  'data.requirePassword',
  'display.dateFormat',
  'display.timeFormat',
  'notifications.enableNotifications',
  'pos.autoPrintReceipt',
] as const;

/** True when a settings key has been removed from the application. */
export function isRetiredSettingKey(key: string): boolean {
  return (RETIRED_SETTING_KEYS as readonly string[]).includes(key);
}

/**
 * Drops retired keys for EVERY reader, admin included.
 *
 * A dead key is not a secret, so it is not an access-control problem the way
 * `remote.*` is. It is still wrong to hand one back: the client has no field for
 * it, so it can only ever become dead weight in the payload and in any
 * localStorage mirror built from it.
 */
export function withoutRetiredSettings(
  settings: Record<string, string>
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (isRetiredSettingKey(key)) continue;
    kept[key] = value;
  }
  return kept;
}
