import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/require-auth';
import { generateToken, verifyPassword } from '@/lib/auth';
import { logAudit, getClientIp } from '@/lib/audit';

const publicUser = {
  id: true, name: true, email: true, role: true, phone: true, active: true,
  mustChangePassword: true, createdAt: true,
} as const;

/**
 * PATCH /api/auth/profile — update the signed-in user's display name and/or
 * email. Changing the email requires the CURRENT password (credential binding
 * is a sensitive action — Rule: identity is never trusted from the body).
 *
 * Body: { name?: string, email?: string, currentPassword?: string }
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const { name, email, currentPassword } = body;

    const user = await db.user.findUnique({ where: { id: auth.user!.userId } });
    if (!user || !user.active) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const data: { name?: string; email?: string } = {};

    if (name && typeof name === 'string' && name.trim()) {
      data.name = name.trim();
    }

    if (email && typeof email === 'string' && email.trim().toLowerCase() !== user.email) {
      const normalizedEmail = email.trim().toLowerCase();

      if (!currentPassword || !(await verifyPassword(currentPassword, user.password))) {
        return NextResponse.json(
          { error: 'Current password is required to change your email' },
          { status: 401 }
        );
      }

      const existing = await db.user.findUnique({ where: { email: normalizedEmail } });
      if (existing && existing.id !== user.id) {
        return NextResponse.json(
          { error: 'That email is already in use by another account' },
          { status: 409 }
        );
      }
      data.email = normalizedEmail;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data,
      select: publicUser,
    });

    await logAudit({
      userId: user.id,
      action: 'UPDATE',
      entity: 'User',
      entityId: user.id,
      details: [
        data.name ? `Name updated to "${updated.name}"` : null,
        data.email ? `Email updated to ${updated.email}` : null,
      ].filter(Boolean).join(' · ') || 'Profile updated',
      ipAddress: getClientIp(request),
    });

    // Re-issue the JWT so an updated email is reflected in the session
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
    console.error('Profile update error:', error);
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}