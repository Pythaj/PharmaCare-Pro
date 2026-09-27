/**
 * Customer input validation — single source of truth (Rule 18) for the customer
 * routes, matching the pattern used for accounts in lib/user-input.
 *
 * POST /api/customers only checked that a name was present, while
 * PATCH /api/customers/[id] checked nothing at all: `name: 123` or
 * `email: {}` reached Prisma and came back as a 500, and `name: ""` could blank
 * a customer's name. Both handlers now go through these parsers, so the two
 * screens cannot disagree about what a valid customer is.
 *
 * Pure and dependency-free: it never touches Prisma.
 */

import { normalizeEmail, isValidEmail } from '@/lib/email';
import type { FieldResult } from '@/lib/user-input';

const MAX_NAME = 120;
const MAX_EMAIL = 254;
const MAX_PHONE = 40;
const MAX_ADDRESS = 200;

/** Shared by the optional fields below: blank/absent means "clear the value". */
function parseOptionalString(
  value: unknown,
  max: number,
  label: string
): FieldResult<string | null> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: `${label} must be text` };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  if (trimmed.length > max) {
    return { ok: false, error: `${label} must be ${max} characters or fewer` };
  }
  return { ok: true, value: trimmed };
}

export function parseCustomerName(value: unknown): FieldResult<string> {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, error: 'Customer name is required' };
  }
  const name = value.trim();
  if (name.length > MAX_NAME) {
    return { ok: false, error: `Customer name must be ${MAX_NAME} characters or fewer` };
  }
  return { ok: true, value: name };
}

export function parseOptionalCustomerEmail(value: unknown): FieldResult<string | null> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: 'Email must be text' };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  if (trimmed.length > MAX_EMAIL) {
    return { ok: false, error: `Email must be ${MAX_EMAIL} characters or fewer` };
  }
  // Stored normalised so the same person cannot be registered twice under
  // different casing, exactly like staff accounts.
  const email = normalizeEmail(trimmed);
  if (!isValidEmail(email)) {
    return { ok: false, error: 'Please enter a valid email address' };
  }
  return { ok: true, value: email };
}

export function parseOptionalCustomerPhone(value: unknown): FieldResult<string | null> {
  return parseOptionalString(value, MAX_PHONE, 'Phone');
}

export function parseOptionalCustomerAddress(value: unknown): FieldResult<string | null> {
  return parseOptionalString(value, MAX_ADDRESS, 'Address');
}
