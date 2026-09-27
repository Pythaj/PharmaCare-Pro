/**
 * User input validation — single source of truth (Rule 18) for the account
 * routes. The create, PUT-update and PATCH-update handlers all validated
 * slightly different things, so a value one screen accepted another rejected
 * (and the weakest one won, leaking raw Prisma errors on a duplicate email).
 * Every field now goes through the same parser.
 *
 * Pure and dependency-free: it never touches Prisma, so uniqueness is checked
 * by the route after parsing.
 */

import { normalizeEmail, isValidEmail } from '@/lib/email';
import { validateNewPassword } from '@/lib/password-policy';

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseEmail(value: unknown, label = 'Email'): FieldResult<string> {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, error: `${label} is required` };
  }
  const email = normalizeEmail(value);
  if (!isValidEmail(email)) {
    return { ok: false, error: 'Please enter a valid email address' };
  }
  return { ok: true, value: email };
}

export function parseName(value: unknown, label = 'Name'): FieldResult<string> {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, error: `${label} is required` };
  }
  const name = value.trim();
  if (name.length > 120) {
    return { ok: false, error: `${label} must be 120 characters or fewer` };
  }
  return { ok: true, value: name };
}

export function parsePhone(value: unknown): FieldResult<string | null> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: 'Phone must be a string' };
  }
  const phone = value.trim();
  if (phone.length > 40) {
    return { ok: false, error: 'Phone must be 40 characters or fewer' };
  }
  return { ok: true, value: phone.length > 0 ? phone : null };
}

export const USER_ROLES = ['admin', 'sales'] as const;
export type UserRoleValue = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRoleValue {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

export function parseRole(value: unknown): FieldResult<UserRoleValue> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: 'sales' };
  }
  if (!isUserRole(value)) {
    return { ok: false, error: 'Role must be either "admin" or "sales"' };
  }
  return { ok: true, value };
}

/**
 * Role for a PATCH-style partial update. Unlike parseRole (used by create and
 * PUT, where a missing role means "new account defaults to cashier") an omitted
 * or blank role here means "leave the role alone".
 *
 * The distinction matters: parseRole('') resolves to 'sales', so a blank field
 * in a partial update would silently demote an administrator — including the
 * last one, locking everyone out of the user screen.
 */
export function parseOptionalRole(
  value: unknown
): FieldResult<UserRoleValue | undefined> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: undefined };
  }
  if (!isUserRole(value)) {
    return { ok: false, error: 'Role must be either "admin" or "sales"' };
  }
  return { ok: true, value };
}

/**
 * Account enabled flag. Only a real boolean is accepted: `active: "false"` used
 * to slip past every lockout guard (which compared against `false`) and then
 * reach Prisma as a non-boolean, turning a form error into a 500.
 */
export function parseActive(value: unknown): FieldResult<boolean> {
  if (typeof value === 'boolean') {
    return { ok: true, value };
  }
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: true };
  }
  return { ok: false, error: 'Active must be true or false' };
}

export function parseOptionalActive(
  value: unknown
): FieldResult<boolean | undefined> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'boolean') {
    return { ok: false, error: 'Active must be true or false' };
  }
  return { ok: true, value };
}

/**
 * Branch assignment for a user.
 *
 * `null` means "every branch" and is only meaningful for an admin — it is the
 * owner being able to see the whole business. A salesperson MUST have a branch:
 * an unassigned cashier would have no till to sell from and, worse, `null`
 * reads as "all branches" in a scope filter, which would silently promote them
 * to company-wide read access. `parseBranchForRole` enforces that pairing.
 */
export function parseBranchId(value: unknown): FieldResult<string | null> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: 'Branch must be text' };
  }
  const trimmed = value.trim();
  return { ok: true, value: trimmed.length > 0 ? trimmed : null };
}

/**
 * Cross-field rule: role and branch must agree.
 *
 * - sales  -> a concrete branch is REQUIRED (never null).
 * - admin  -> null (all branches) or a specific branch; both are valid.
 */
export function parseBranchForRole(
  role: string,
  value: unknown
): FieldResult<string | null> {
  const parsed = parseBranchId(value);
  if (!parsed.ok) return parsed;

  if (role === 'admin') {
    return parsed;
  }

  if (!parsed.value) {
    return {
      ok: false,
      error: 'A sales account must be assigned to a branch',
    };
  }
  return parsed;
}


export function parsePassword(value: unknown, label = 'Password'): FieldResult<string> {
  const error = validateNewPassword(value, label);
  if (error) return { ok: false, error };
  return { ok: true, value: value as string };
}
