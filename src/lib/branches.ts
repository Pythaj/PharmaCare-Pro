/**
 * Branch scoping — the single source of truth for "which shop is this request
 * allowed to see?" (Rule 18).
 *
 * WHY THIS FILE EXISTS
 *
 * Before branches, every route filtered by `userId` (own vs all). That is no
 * longer enough: a supervisor who is an admin at Main but has never visited the
 * new branch still must not silently read that branch's takings by accident,
 * and a salesperson must never be able to widen their own scope. If each route
 * hand-rolls its own filter, one forgotten `where` clause is a cross-branch
 * data leak. So there is exactly one resolver and one `where` builder, and
 * routes are expected to use them.
 *
 * THE SECURITY RULE
 *
 * The active branch comes from the SESSION, never from a request body or query
 * parameter. This mirrors the existing "identity is never trusted from the
 * body" rule: if a route accepted `?branchId=...` from the client, any cashier
 * could read any branch's sales by editing a URL. `requestedBranchId` below
 * exists only for an ADMIN's *validated preference* (e.g. a dashboard filter)
 * and is still checked against what the user is allowed to see.
 */

import type { UserRole } from '@/lib/require-auth';

/** Sentinel used by the client and the API to mean "no branch filter". */
export const ALL_BRANCHES = 'all';

export interface BranchScope {
  /** The branch to filter by. `null` means EVERY branch (consolidated view). */
  branchId: string | null;
  /** The user's home branch. `null` for admins, who are not tied to a counter. */
  homeBranchId: string | null;
  /** Short code of `branchId`, used to build per-branch invoice numbers. */
  branchCode: string | null;
  isAdmin: boolean;
  /** True only when an admin is deliberately viewing the whole business. */
  isAllBranches: boolean;
}

export interface SessionBranchUser {
  role: UserRole;
  /** Home branch from the live database row. */
  branchId: string | null;
  /**
   * Branch the user is currently operating in, taken from the signed token and
   * re-validated against the live row on every request.
   */
  activeBranchId?: string | null;
}

/**
 * Thrown when a user has no usable branch. A salesperson who has not been
 * assigned to a branch is a configuration mistake, and the only safe reading of
 * a request from them is "no branch" — which means denying it, not treating a
 * missing branch as "every branch". The second reading would hand the most
 * restricted accounts in the system the widest view of the business.
 */
export class BranchConfigurationError extends Error {
  constructor(message = 'No branch is assigned to this account') {
    super(message);
    this.name = 'BranchConfigurationError';
  }
}

/**
 * Resolves the scope a request must be filtered by.
 *
 * Rules, in order:
 *  - A salesperson is ALWAYS pinned to their home branch, and the home branch
 *    must exist. A missing assignment throws rather than returning an empty
 *    filter, because an empty filter means "all branches" and that would be a
 *    silent privilege escalation.
 *  - An admin may select any active branch. The selection is their *session*
 *    branch (`activeBranchId`, re-validated on every request), not a value the
 *    caller of this function invents. An explicit `requestedBranchId` may only
 *    narrow further and is still checked against the session by the caller.
 *  - An admin with no selected branch is deliberately viewing the whole
 *    business, which is the normal owner view.
 */
export function resolveScope(
  user: SessionBranchUser,
  requestedBranchId?: string | null
): BranchScope {
  const isAdmin = user.role === 'admin';

  if (!isAdmin) {
    if (!user.branchId) {
      throw new BranchConfigurationError();
    }
    return {
      branchId: user.branchId,
      homeBranchId: user.branchId,
      branchCode: null,
      isAdmin: false,
      isAllBranches: false,
    };
  }

  // The session's active branch is the real preference and it wins. An explicit
  // `requestedBranchId` is read ONLY when the session is deliberately on "all
  // branches", which is the one case where narrowing is a real request rather
  // than an attempt to escape a branch.
  //
  // The order matters and was previously inverted (`requestedBranchId ??
  // activeBranchId`). That made a request able to REPLACE the session's branch:
  // an admin parked on Branch A, hitting a route that passed a request value, got
  // that route's branch instead — a widening, the opposite of what the function
  // documents. Precedence has to be session-first for "may only narrow" to be
  // true. The caller remains responsible for validating that a narrowed branch
  // exists and is active.
  const effective = user.activeBranchId ?? requestedBranchId ?? null;

  // An admin asking for "everything" explicitly, or with no preference.
  const wantsAll =
    effective === null || effective === undefined || effective === ALL_BRANCHES;

  if (wantsAll) {
    return {
      branchId: null,
      homeBranchId: user.branchId,
      branchCode: null,
      isAdmin: true,
      isAllBranches: true,
    };
  }

  return {
    branchId: effective,
    homeBranchId: user.branchId,
    branchCode: null,
    isAdmin: true,
    isAllBranches: false,
  };
}

/**
 * Prisma `where` fragment for a branch-owned table (Sale, Batch, Purchase,
 * DailySalesRecord). Spread it into a query rather than hand-writing
 * `branchId: ...` so the "null means all branches" rule lives in one place.
 *
 * `resolveScope` guarantees `branchId` is non-null for anyone who is not an
 * admin viewing all branches, so an empty fragment can only be produced by that
 * one deliberate state.
 */
export function branchWhere(scope: BranchScope): { branchId?: string } {
  return scope.branchId ? { branchId: scope.branchId } : {};
}

/**
 * Same as `branchWhere` but for a to-one `branch` relation, e.g. the batches of
 * a product. The filter is on the branch's own primary key — a nested
 * `branchId` would silently match nothing (or, worse, be dropped by the
 * client) because `Branch` has no such field.
 */
export function branchRelationWhere(
  scope: BranchScope,
  relation: string = 'branch'
): Record<string, { id: string }> {
  return scope.branchId ? { [relation]: { id: scope.branchId } } : {};
}

/**
 * The branch a NEW record must be stamped with. Never null for a write: a sale
 * with no branch cannot be reported on, so an unconfigured salesperson must be
 * stopped here rather than produce unattributable money.
 *
 * @returns the branch id, or null when the caller must reject the write.
 */
export function branchIdForWrite(scope: BranchScope): string | null {
  // Admins may transact in a specific branch but not in "all branches" — money
  // must always belong to exactly one till.
  if (scope.branchId) return scope.branchId;
  return null;
}

/** Human label for the UI, e.g. "Main Branch" or "All branches". */
export function scopeLabel(scope: BranchScope, branchName?: string | null): string {
  if (scope.isAllBranches) return 'All branches';
  return branchName || 'Current branch';
}

/**
 * Validates a branch code used in invoice numbers. Codes end up inside a
 * printed receipt, so keep them short and unambiguous — no spaces, no symbols
 * that could be mistaken for part of the number.
 */
export function isValidBranchCode(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Z0-9]{2,10}$/.test(code);
}

/** Normalises typed input ("main " / "main") to the stored form ("MAIN"). */
export function normalizeBranchCode(code: string): string {
  return code.trim().toUpperCase();
}
