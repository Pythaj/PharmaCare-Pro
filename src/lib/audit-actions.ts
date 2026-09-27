/**
 * Canonical audit vocabulary — single source of truth (Rule 18) shared by the
 * API routes that write audit rows and the admin UI that filters them.
 *
 * Deliberately dependency-free so it can be imported from client components
 * without dragging the Prisma-backed audit helper into the browser bundle.
 * Keep it in sync by writing actions from this list, never as string literals.
 */

export const AUDIT_ACTIONS = [
  'LOGIN',
  'LOGOUT',
  'LOGIN_FAILED',
  'CREATE',
  'UPDATE',
  'DELETE',
  'SALE_COMPLETE',
  'RETURN',
  'CLOSE_DAY',
  'REOPEN_DAY',
  'TRANSFER_APPROVE',
  'TRANSFER_COMPLETE',
  'TRANSFER_REJECT',
  'SETUP',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Entities the app records changes against. */
export const AUDIT_ENTITIES = [
  'User',
  'Product',
  'Category',
  'Batch',
  'Customer',
  'Sale',
  'Return',
  'SystemSetting',
  'DailySalesRecord',
  'Branch',
  'StockTransfer',
] as const;

export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

/** Badge colours per action, so every real action is visually distinct. */
export const AUDIT_ACTION_COLORS: Record<AuditAction, string> = {
  LOGIN: 'border-blue-300 text-blue-700 bg-blue-50',
  LOGOUT: 'border-slate-300 text-slate-700 bg-slate-50',
  LOGIN_FAILED: 'border-red-300 text-red-700 bg-red-50',
  CREATE: 'border-emerald-300 text-emerald-700 bg-emerald-50',
  UPDATE: 'border-amber-300 text-amber-700 bg-amber-50',
  DELETE: 'border-red-300 text-red-700 bg-red-50',
  SALE_COMPLETE: 'border-teal-300 text-teal-700 bg-teal-50',
  RETURN: 'border-purple-300 text-purple-700 bg-purple-50',
  CLOSE_DAY: 'border-indigo-300 text-indigo-700 bg-indigo-50',
  REOPEN_DAY: 'border-orange-300 text-orange-700 bg-orange-50',
  // Stock movement is the one event where "who moved whose drugs, and when" is
  // the first question asked at a loss investigation, so each stage of a
  // transfer is its own action rather than a generic UPDATE.
  TRANSFER_APPROVE: 'border-sky-300 text-sky-700 bg-sky-50',
  TRANSFER_COMPLETE: 'border-cyan-300 text-cyan-700 bg-cyan-50',
  TRANSFER_REJECT: 'border-rose-300 text-rose-700 bg-rose-50',
  SETUP: 'border-cyan-300 text-cyan-700 bg-cyan-50',
};
