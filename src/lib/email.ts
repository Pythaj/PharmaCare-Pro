/**
 * Email normalisation — single source of truth (Rule 18).
 *
 * Addresses were stored and compared with whatever casing the user typed, while
 * the first-time setup screen lower-cased them. The result: `Ana@Pharmacy.com`
 * and `ana@pharmacy.com` became two different people, and one of them could
 * not log in. Every read and write now goes through here, so an address is the
 * same key everywhere in the app.
 *
 * Dependency-free so both API routes and client forms can use it.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Trims and lowercases when the value is a usable string, else null. */
export function normalizeEmailOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeEmail(value);
  return normalized.length > 0 ? normalized : null;
}

/**
 * Deliberately permissive but structural: one @, no spaces, a dot in the
 * domain. Anything stricter starts rejecting valid addresses.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}
