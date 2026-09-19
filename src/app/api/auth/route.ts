import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword, generateToken } from '@/lib/auth';
import { getAuthUser } from '@/lib/require-auth';

const publicUser = {
  id: true, name: true, email: true, role: true, phone: true, active: true,
  mustChangePassword: true, createdAt: true,
} as const;

// GET /api/auth — lightweight session check.
// Returns the current user (from the HttpOnly JWT cookie) or 401 when the
// session is missing/expired. Used by the client to validate persisted
// sessions on load instead of trusting localStorage indefinitely.
export async function GET(request: NextRequest) {
  const payload = await getAuthUser(request);
  if (!payload?.userId) {
    // Also covers stale-but-validly-signed tokens that carry no usable user id
    // — treat as unauthenticated and drop the offending cookie instead of
    // hitting the DB with `id: undefined`.
    const response = NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    response.cookies.set('auth_token', '', { httpOnly: true, maxAge: 0, path: '/' });
    return response;
  }

  // Confirm the account still exists and is active (revocation support)
  const user = await db.user.findUnique({
    where: { id: payload.userId },
    select: publicUser,
  });

  if (!user || !user.active) {
    const response = NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    response.cookies.set('auth_token', '', { httpOnly: true, maxAge: 0, path: '/' });
    return response;
  }

  return NextResponse.json({ user });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({
      where: { email },
    });

    if (!user || !user.active) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const isValidPassword = await verifyPassword(password, user.password);
    if (!isValidPassword) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // Return user without password
    const { password: _, ...safeUser } = user;

    const response = NextResponse.json(
      { user: safeUser, token, mustChangePassword: user.mustChangePassword },
      { status: 200 }
    );

    // Desktop: loopback HTTP must not require the Secure flag (localhost is a
    // trustworthy origin, but the packaged Electron server is plain HTTP).
    const secureCookie = process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false';
    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
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

export async function DELETE() {
  const response = NextResponse.json({ message: 'Logged out' });
  response.cookies.set('auth_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}