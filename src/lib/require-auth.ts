import { NextRequest } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import { db } from '@/lib/db';
import { resolveScope, BranchConfigurationError, type BranchScope } from '@/lib/branches';

/**
 * Authorization gate for every protected API route.
 *
 * The JWT proves *who* signed in, but it is a 7-day-old snapshot. It must never
 * be the authority for *what they may do*: a demoted cashier or a deactivated
 * account would otherwise keep admin access and live data until the token
 * expired. So every request resolves the current user from the database and
 * takes the role, active flag and password state from there. That is one extra
 * indexed primary-key lookup per request — cheap, and the only way
 * authorization is actually correct.
 */

export type UserRole = 'admin' | 'sales';

export interface SessionUser {
  userId: string;
  name: string;
  email: string;
  /** Normalised: anything other than "admin" is treated as "sales" (deny by default). */
  role: UserRole;
  active: boolean;
  mustChangePassword: boolean;
  /** Home branch from the live row. `null` for admins = every branch. */
  branchId: string | null;
  /**
   * Branch the user is currently operating in, re-validated against the live
   * row on every request. `null` for an admin viewing the whole business.
   */
  activeBranchId: string | null;
}

export type AuthErrorCode = 'PASSWORD_CHANGE_REQUIRED' | 'FORBIDDEN';

export interface AuthResult {
  success: boolean;
  user?: SessionUser;
  error?: string;
  status?: number;
  /** Lets a route answer 403 with the setup redirect instead of a generic error. */
  code?: AuthErrorCode;
}

export interface RequireAuthOptions {
  /**
   * Allow through a user flagged with `mustChangePassword`. Reserved for the
   * routes a flagged account legitimately needs: profile fetch, password
   * setup/change, and logout. Every business route leaves this off.
   */
  allowPasswordChange?: boolean;
}

/** DB roles are a plain string; normalise so a bogus value can never grant admin. */
function normalizeRole(role: string): UserRole {
  return role === 'admin' ? 'admin' : 'sales';
}

function extractToken(request: NextRequest): string | null {
  return getTokenFromHeader(request.headers.get('authorization')) ||
    request.cookies.get('auth_token')?.value ||
    null;
}

type SessionResult =
  | { ok: true; user: SessionUser }
  | { ok: false; result: AuthResult };

async function resolveSession(
  request: NextRequest,
  options: RequireAuthOptions
): Promise<SessionResult> {
  const token = extractToken(request);
  if (!token) {
    return { ok: false, result: { success: false, error: 'Authentication required', status: 401 } };
  }

  const payload = verifyToken(token);
  if (!payload) {
    return { ok: false, result: { success: false, error: 'Invalid or expired token', status: 401 } };
  }

  const account = await db.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      mustChangePassword: true,
      branchId: true,
    },
  });

  // A token can outlive the account it names (deleted or re-seeded user).
  if (!account) {
    return { ok: false, result: { success: false, error: 'Account no longer exists', status: 401 } };
  }

  // Deactivating an account must take effect immediately, not at token expiry.
  if (!account.active) {
    return { ok: false, result: { success: false, error: 'Account is deactivated', status: 401 } };
  }

  const role = normalizeRole(account.role);

  // The token's branch is a preference, not an authority. Re-derive it from the
  // live row so three things cannot be exploited:
  //  1. A demoted admin keeps their old token but loses all-branch access.
  //  2. A salesperson moved to another branch is not still scoped to the old one.
  //  3. A branch that was deactivated (or deleted, which nulls the id) stops
  //     being selectable instead of silently returning no data forever.
  let activeBranchId: string | null = null;
  if (role === 'admin') {
    // Admins may sit in any active branch, or none (= whole business). A token
    // naming a branch that has since been deactivated falls back to all-branch
    // rather than locking the owner out of their own system.
    const requested = payload.branchId ?? null;
    if (requested) {
      const branch = await db.branch.findUnique({
        where: { id: requested },
        select: { id: true, active: true },
      });
      activeBranchId = branch?.active ? branch.id : null;
    }
  } else {
    // A salesperson is pinned to their home branch, full stop. The token's
    // claim is ignored entirely rather than trusted.
    activeBranchId = account.branchId;
  }

  const user: SessionUser = {
    userId: account.id,
    name: account.name,
    email: account.email,
    role,
    active: account.active,
    mustChangePassword: account.mustChangePassword,
    branchId: account.branchId,
    activeBranchId,
  };

  // A temporary password unlocks the password screen and nothing else.
  if (user.mustChangePassword && !options.allowPasswordChange) {
    return {
      ok: false,
      result: {
        success: false,
        error: 'Password change required',
        status: 403,
        code: 'PASSWORD_CHANGE_REQUIRED',
      },
    };
  }

  return { ok: true, user };
}

export async function requireAuth(
  request: NextRequest,
  options: RequireAuthOptions = {}
): Promise<AuthResult> {
  const session = await resolveSession(request, options);
  if (!session.ok) return session.result;
  return { success: true, user: session.user };
}

/** Admin access is decided by the live database role, never by the token. */
export async function requireAdmin(
  request: NextRequest,
  options: RequireAuthOptions = {}
): Promise<AuthResult> {
  const auth = await requireAuth(request, options);
  if (!auth.success) return auth;

  if (auth.user?.role !== 'admin') {
    return { success: false, error: 'Admin access required', status: 403 };
  }

  return auth;
}

/** Live session lookup for routes that need identity without a hard gate. */
export async function getAuthUser(
  request: NextRequest,
  options: RequireAuthOptions = {}
): Promise<SessionUser | null> {
  const session = await resolveSession(request, options);
  if (!session.ok) return null;
  // Return a plain literal owned by THIS module. Cross-module object graphs
  // that carry a foreign "realm" tag have been observed losing their
  // properties when handed back to the compiled route handler, so never pass
  // the verifyToken() result object through directly.
  const { userId, name, email, role, active, mustChangePassword, branchId, activeBranchId } =
    session.user;
  return {
    userId,
    name,
    email,
    role,
    active,
    mustChangePassword,
    branchId,
    activeBranchId,
  };
}

/**
 * Auth PLUS the branch scope every branch-aware route needs.
 *
 * This exists so a route cannot accidentally skip branch scoping: it is one
 * call that returns the session and the validated scope together, and the scope
 * is derived from the live user row (see resolveSession) rather than from
 * anything the client sent.
 */
export interface BranchAuthResult {
  success: boolean;
  user?: SessionUser;
  scope?: BranchScope;
  /** Resolved details of the active branch, for labelling responses/receipts. */
  branch?: { id: string; name: string; code: string } | null;
  error?: string;
  status?: number;
  code?: AuthErrorCode;
}

export async function requireBranchScope(
  request: NextRequest,
  options: RequireAuthOptions & { admin?: boolean } = {}
): Promise<BranchAuthResult> {
  const auth = options.admin ? await requireAdmin(request, options) : await requireAuth(request, options);
  if (!auth.success || !auth.user) return auth;

  const user = auth.user;
  // The active branch is a session value, not a request value. Passing
  // user.activeBranchId is deliberate: this helper never accepts a
  // client-supplied branch, so a route cannot be talked into reading another
  // branch by a query parameter.
  let scope: BranchScope;
  try {
    scope = resolveScope({
      role: user.role,
      branchId: user.branchId,
      activeBranchId: user.activeBranchId,
    });
  } catch (err) {
    // A salesperson with no home branch. Deny rather than fall back to an
    // unfiltered query, which would read as "all branches".
    if (err instanceof BranchConfigurationError) {
      return {
        success: false,
        error:
          'Your account has no branch assigned. Ask an administrator to assign you to a branch.',
        status: 403,
        code: 'FORBIDDEN',
      };
    }
    throw err;
  }

  let branch: BranchAuthResult['branch'] = null;
  if (scope.branchId) {
    const found = await db.branch.findUnique({
      where: { id: scope.branchId },
      select: { id: true, name: true, code: true },
    });
    // The branch vanished between auth and here. Fail closed rather than serve
    // an unfiltered response that looks branch-scoped.
    if (!found) {
      return { success: false, error: 'Your branch is no longer available', status: 403 };
    }
    branch = found;
    scope.branchCode = found.code;
  }

  return { success: true, user, scope, branch };
}
