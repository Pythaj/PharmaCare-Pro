/**
 * Prisma error-shape predicates — single source of truth (Rule 18).
 *
 * The app has three places that need to recognise a unique-constraint failure by
 * shape rather than by `instanceof`: the sale handler (invoice number collisions
 * it must retry) and the daily register (one register per branch per day). Prisma
 * is not a dependency of the pure logic modules, so the code cannot import its
 * error classes here, and a hand-rolled `instanceof` against a driver that did
 * not throw is exactly what silently turns a retryable race into a 500.
 *
 * The `meta.target` shape differs between the query engine and the older Rust
 * engines, and between drivers, so both the array and the bare-string form are
 * handled.
 */

interface PrismaLikeError {
  code?: unknown;
  meta?: { target?: unknown } | null;
}

/** True when `error` is any Prisma unique-constraint violation (P2002). */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return (error as PrismaLikeError | null)?.code === 'P2002';
}

/**
 * True only when the violation was on a specific unique field.
 *
 * Narrow on purpose: a sale-create transaction has other things that can fail,
 * and retrying those would re-run side effects or mask a real business rule. Only
 * the invoice-number race is safe to retry, because the losing attempt has already
 * rolled back entirely.
 *
 * @param field Unique field name, e.g. `invoiceNo`. Omit to match any P2002.
 */
export function isUniqueViolationOn(error: unknown, field: string): boolean {
  if (!isUniqueConstraintViolation(error)) return false;

  const target = (error as PrismaLikeError).meta?.target;
  if (Array.isArray(target)) {
    return target.some((entry) => String(entry).includes(field));
  }
  // Some drivers report the constraint as a bare string.
  return typeof target === 'string' && target.includes(field);
}