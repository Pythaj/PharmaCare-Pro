import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/require-auth';
import { generateToken, verifyPassword, hashPassword } from '@/lib/auth';
import { logAudit, getClientIp } from '@/lib/audit';

/**
 * POST /api/auth/change-password — change the signed-in user's password. Also
 * clears the first-time-setup flag in case a user changes their password from
 * the account settings before completing setup on purpose.
 *
 * Body: { currentPassword: string, newPassword: string }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
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

    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters' },
        { status: 400 }
      );
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

    // Re-issue a fresh token so other sessions keep a consistent signature
    const token = generateToken({
      userId: updated.id,
      email: updated.email,
      role: updated.role,
    });

    const response = NextResponse.json({ message: 'Password updated', user: updated, token }, { status: 200 });
    const secureCookie = process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false';
    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Change password error:', error);
    return NextResponse.json(
      { error: 'Failed to change password' },
      { status: 500 }
    );
  }
}