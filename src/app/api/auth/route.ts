import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword, generateToken } from '@/lib/auth';
import { getAuthUser } from '@/lib/require-auth';
import { logAudit, getClientIp } from '@/lib/audit';
import { normalizeEmail } from '@/lib/email';
import {
  setAuthCookie as setAuthCookieImpl,
  clearAuthCookie,
  AUTH_COOKIE_MAX_AGE,
} from '@/lib/auth-cookie';

const publicUser = {
  id: true, name: true, email: true, role: true, phone: true, active: true,
  mustChangePassword: true, createdAt: true, branchId: true,
} as const;



/**
 * A real bcrypt hash of a throwaway string, compared against when the email is
 * unknown. Without it, "no such user" returns in ~1ms while "wrong password"
 * takes ~100ms, which is enough to enumerate staff email addresses.
 * Regenerate with: node -e "console.log(require('bcryptjs').hashSync('x', 10))"
 */
const TIMING_EQUALIZER_HASH = '$2b$10$crg3.5kUjDMtkLv/RQmz1.JS5yT7sgfKoJqQE4Gpu6H1nTN.OZBgO';

function unauthenticated(error: string): NextResponse {
  const response = NextResponse.json({ error }, { status: 401 });
  clearAuthCookie(response);
  return response;
}

// GET /api/auth — lightweight session check.
// Returns the current user (from the HttpOnly JWT cookie) or 401 when the
// session is missing/expired. Used by the client to validate persisted
// sessions on load instead of trusting localStorage indefinitely.
export async function GET(request: NextRequest) {
  // allowPasswordChange: a flagged account must still be able to load the app
  // shell so it can show the first-time password screen.
  const session = await getAuthUser(request, { allowPasswordChange: true });
  if (!session?.userId) {
    // Also covers stale-but-validly-signed tokens that carry no usable user id
    // or a deleted/inactive account — treat as unauthenticated and drop the
    // offending cookie instead of handing the client a dead session.
    return unauthenticated('Not authenticated');
  }

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: publicUser,
  });

  if (!user || !user.active) {
    return unauthenticated('Session invalid');
  }

  // The database is the source of truth for role and password state, so the
  // client never acts on a stale token snapshot.
  //
  // `activeBranchId` is echoed back separately from `user.branchId` because they
  // mean different things: `user.branchId` is where a salesperson is employed,
  // while `activeBranchId` is which shop's numbers an admin is currently looking
  // at. The header renders one from each.
  const activeBranchId =
    user.role === 'admin' ? session.activeBranchId ?? null : user.branchId;

  const activeBranch = activeBranchId
    ? await db.branch.findUnique({
        where: { id: activeBranchId },
        select: { id: true, name: true, code: true },
      })
    : null;

  return NextResponse.json({
    user,
    mustChangePassword: user.mustChangePassword,
    role: user.role === 'admin' ? 'admin' : 'sales',
    activeBranchId: activeBranch?.id ?? null,
    activeBranch,
    // Admins default to the consolidated view; sales users are pinned.
    isAllBranches: user.role === 'admin' && !activeBranch,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const normalizedEmail = normalizeEmail(email);

    // Emails are stored normalised (lib/email), so normalise on lookup too —
    // otherwise a staff member who signed up as "Ana@Pharmacy.com" can never
    // log in.
    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !user.active) {
      // Spend the same time as a real comparison so the response time does not
      // reveal whether the account exists.
      await verifyPassword(password, TIMING_EQUALIZER_HASH);

      await logAudit({
        userId: user?.id ?? null,
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: user?.id ?? null,
        details: `Failed sign-in attempt for ${normalizedEmail}`,
        ipAddress: getClientIp(request),
      });

      // Deliberately identical for "unknown email", "deactivated" and
      // "wrong password" so the endpoint never confirms which one it was.
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const isValidPassword = await verifyPassword(password, user.password);
    if (!isValidPassword) {
      await logAudit({
        userId: user.id,
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: user.id,
        details: 'Incorrect password',
        ipAddress: getClientIp(request),
      });

      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      // A salesperson starts in their home branch; an admin starts with no
      // branch selected, which the UI presents as the consolidated
      // "All branches" view. The claim is a preference only — requireAuth
      // re-validates it against the live user row on every request.
      branchId: user.role === 'admin' ? null : user.branchId,
    });

    // Return user without password. The token itself is NOT returned in the
    // body: it lives only in an HttpOnly cookie, so script running in the page
    // (XSS) can never read it.
    const { password: _password, ...safeUser } = user;

    const response = NextResponse.json(
      { user: safeUser, mustChangePassword: user.mustChangePassword },
      { status: 200 }
    );
    setAuthCookieImpl(response, token, AUTH_COOKIE_MAX_AGE);

    await logAudit({
      userId: user.id,
      action: 'LOGIN',
      entity: 'User',
      entityId: user.id,
      details: `Signed in as ${user.role}`,
      ipAddress: getClientIp(request),
    });

    return response;
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  // Audit before clearing the cookie so the signed-in user is still known.
  const session = await getAuthUser(request, { allowPasswordChange: true });
  if (session) {
    await logAudit({
      userId: session.userId,
      action: 'LOGOUT',
      entity: 'User',
      entityId: session.userId,
      details: 'Signed out',
      ipAddress: getClientIp(request),
    });
  }

  const response = NextResponse.json({ message: 'Logged out' });
  setAuthCookieImpl(response, '', 0);
  return response;
}

