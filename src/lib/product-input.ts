/**
 * Product input validation — single source of truth (Rule 18) for the product
 * routes, matching the pattern used for accounts and customers.
 *
 * Two real defects lived here:
 *
 * 1. PUT /api/products/[id] copied the request body straight into Prisma, so a
 *    non-numeric price or a boolean-typed `active` came back as a raw 500.
 * 2. POST used `reorderLevel || 10`, which turns a deliberate 0 into 10. Zero is
 *    the app's "never reorder" sentinel (see classifyStock in
 *    lib/inventory-alerts), so every product an admin set to never-reorder was
 *    silently flagged as low stock and could never be expressed correctly.
 *
 * Pure and dependency-free: it never touches Prisma.
 */

import type { FieldResult } from '@/lib/user-input';

const MAX_NAME = 200;
const MAX_UNIT = 20;
const MAX_DESCRIPTION = 1000;
const MAX_REORDER_LEVEL = 1_000_000;

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

export function parseProductName(value: unknown): FieldResult<string> {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, error: 'Product name is required' };
  }
  const name = value.trim();
  if (name.length > MAX_NAME) {
    return { ok: false, error: `Product name must be ${MAX_NAME} characters or fewer` };
  }
  return { ok: true, value: name };
}

export function parseOptionalGenericName(value: unknown): FieldResult<string | null> {
  return parseOptionalString(value, MAX_NAME, 'Generic name');
}

export function parseOptionalDescription(value: unknown): FieldResult<string | null> {
  return parseOptionalString(value, MAX_DESCRIPTION, 'Description');
}

/** Blank/absent means "uncategorised"; the route checks the id really exists. */
export function parseOptionalCategoryId(value: unknown): FieldResult<string | null> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: 'Category must be text' };
  }
  const trimmed = value.trim();
  return { ok: true, value: trimmed.length > 0 ? trimmed : null };
}

export function parseProductUnit(value: unknown, fallback = 'units'): FieldResult<string> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: fallback };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: 'Unit must be text' };
  }
  const unit = value.trim();
  if (unit.length === 0) {
    return { ok: true, value: fallback };
  }
  if (unit.length > MAX_UNIT) {
    return { ok: false, error: `Unit must be ${MAX_UNIT} characters or fewer` };
  }
  return { ok: true, value: unit };
}

/**
 * Reorder level. 0 is valid and meaningful ("never reorder"), so this must
 * never be written with `||` — only an absent value falls back.
 */
export function parseReorderLevel(
  value: unknown,
  fallback: number
): FieldResult<number> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: fallback };
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return { ok: false, error: 'Reorder level must be a number' };
  }
  if (!Number.isInteger(n)) {
    return { ok: false, error: 'Reorder level must be a whole number' };
  }
  if (n < 0) {
    return { ok: false, error: 'Reorder level cannot be negative' };
  }
  if (n > MAX_REORDER_LEVEL) {
    return { ok: false, error: `Reorder level must be ${MAX_REORDER_LEVEL} or less` };
  }
  return { ok: true, value: n };
}

/** Price in the pharmacy's currency: a finite, non-negative number. */
export function parseMoney(
  value: unknown,
  label: string,
  fallback: number
): FieldResult<number> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: fallback };
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return { ok: false, error: `${label} must be a number` };
  }
  if (n < 0) {
    return { ok: false, error: `${label} cannot be negative` };
  }
  if (n > 1_000_000_000) {
    return { ok: false, error: `${label} is unrealistically large` };
  }
  return { ok: true, value: n };
}

export function parseOptionalActive(value: unknown): FieldResult<boolean | undefined> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'boolean') {
    return { ok: false, error: 'Active must be true or false' };
  }
  return { ok: true, value };
}
