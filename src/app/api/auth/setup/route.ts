import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/require-auth';
import { generateToken, hashPassword } from '@/lib/auth';
import { logAudit, getClientIp } from '@/lib/audit';
import { validateNewPassword } from '@/lib/password-policy';
import { normalizeEmail } from '@/lib/email';

/**
 * POST /api/auth/setup — first-time credential setup for accounts created with
 * a temporary password. Requires being logged in with that temporary
 * credential. Sets a real password (and optionally a real email), clears the
 * mustChangePassword flag and re-issues the JWT so a changed email applies
 * immediately without forcing a second log-in.
 *
 * Body: { password: string, email?: string }
 */
export async function POST(request: NextRequest) {
  try {
    // allowPasswordChange: this is the one route a flagged account must reach.
    const auth = await requireAuth(request, { allowPasswordChange: true });
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const { password, email } = body;

    const passwordError = validateNewPassword(password, 'New password');
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { id: auth.user!.userId } });
    if (!user || !user.active) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    if (!user.mustChangePassword) {
      return NextResponse.json(
        { error: 'This account has already completed first-time setup' },
        { status: 400 }
      );
    }

    const data: { email?: string; password: string; mustChangePassword: boolean } = {
      password: await hashPassword(password as string),
      mustChangePassword: false,
    };

    if (email && typeof email === 'string' && normalizeEmail(email) !== user.email) {
      const normalizedEmail = normalizeEmail(email);
      const existing = await db.user.findUnique({ where: { email: normalizedEmail } });
      if (existing && existing.id !== user.id) {
        return NextResponse.json(
          { error: 'That email is already in use by another account' },
          { status: 409 }
        );
      }
      data.email = normalizedEmail;
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data,
      select: {
        id: true, name: true, email: true, role: true, phone: true, active: true,
        mustChangePassword: true, createdAt: true,
      },
    });

    await logAudit({
      userId: user.id,
      action: 'SETUP',
      entity: 'User',
      entityId: user.id,
      details: data.email
        ? `Completed first-time setup — password changed and email updated to ${data.email}`
        : 'Completed first-time setup — password changed',
      ipAddress: getClientIp(request),
    });

    const token = generateToken({
      userId: updated.id,
      email: updated.email,
      role: updated.role,
    });

    // The token stays in the HttpOnly cookie only — never in the response body.
    const response = NextResponse.json({ user: updated }, { status: 200 });
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
    console.error('First-time setup error:', error);
    return NextResponse.json(
      { error: 'Failed to complete setup' },
      { status: 500 }
    );
  }
}