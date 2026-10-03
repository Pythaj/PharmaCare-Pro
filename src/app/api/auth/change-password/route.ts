import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/require-auth';
import { generateToken, verifyPassword, hashPassword } from '@/lib/auth';
import { logAudit, getClientIp } from '@/lib/audit';
import { setAuthCookie } from '@/lib/auth-cookie';
import { validateNewPassword } from '@/lib/password-policy';

/**
 * POST /api/auth/change-password — change the signed-in user's password. Also
 * clears the first-time-setup flag in case a user changes their password from
 * the account settings before completing setup on purpose.
 *
 * Body: { currentPassword: string, newPassword: string }
 */
export async function POST(request: NextRequest) {
  try {
    // allowPasswordChange: a flagged account must be able to clear the flag.
    const auth = await requireAuth(request, { allowPasswordChange: true });
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'Current and new password are required' },
        { status: 400 }
      );
    }

    const passwordError = validateNewPassword(newPassword, 'New password');
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { id: auth.user!.userId } });
    if (!user || !user.active) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    if (!(await verifyPassword(currentPassword, user.password))) {
      return NextResponse.json(
        { error: 'Current password is incorrect' },
        { status: 401 }
      );
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: 'New password must be different from your current password' },
        { status: 400 }
      );
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data: {
        password: await hashPassword(newPassword),
        mustChangePassword: false,
      },
      select: {
        id: true, name: true, email: true, role: true, phone: true, active: true,
        mustChangePassword: true, createdAt: true,
      },
    });

    await logAudit({
      userId: user.id,
      action: 'UPDATE',
      entity: 'User',
      entityId: user.id,
      details: 'Password changed',
      ipAddress: getClientIp(request),
    });

    // Re-issue a fresh token so other sessions keep a consistent signature.
    //
    // `branchId` MUST be carried over. It is the session's selected branch, not
    // the account's home branch, and dropping it silently resets an admin to the
    // whole-company view: they would be browsing every branch's takings and,
    // worse, `POST /api/sales` would refuse them with "select a branch" from a
    // till that was working a moment ago.
    const token = generateToken({
      userId: updated.id,
      email: updated.email,
      role: updated.role,
      branchId: auth.user!.activeBranchId,
    });

    // The token is delivered by the HttpOnly cookie only, never in the body.
    const response = NextResponse.json({ message: 'Password updated', user: updated }, { status: 200 });
    setAuthCookie(response, token);

    return response;
  } catch (error) {
    console.error('Change password error:', error);
    return NextResponse.json(
      { error: 'Failed to change password' },
      { status: 500 }
    );
  }
}