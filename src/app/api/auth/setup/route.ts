import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/require-auth';
import { generateToken, hashPassword } from '@/lib/auth';
import { logAudit, getClientIp } from '@/lib/audit';

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
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const { password, email } = body;

    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters' },
        { status: 400 }
      );
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
      password: await hashPassword(password),
      mustChangePassword: false,
    };

    if (email && typeof email === 'string' && email.trim().toLowerCase() !== user.email) {
      const normalizedEmail = email.trim().toLowerCase();
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

    const response = NextResponse.json({ user: updated, token }, { status: 200 });
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