import { NextResponse } from 'next/server';

/** 7 days — must match JWT_EXPIRES_IN in lib/auth.ts. */
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

export const AUTH_COOKIE_NAME = 'auth_token';

/**
 * Writes the signed session to an HttpOnly cookie.
 *
 * The token is never returned in a response body, so script running in the page
 * (XSS) cannot read it. `httpOnly` + `sameSite: 'lax'` is what makes that hold,
 * and it is centralised here because the branch-switch endpoint re-issues the
 * cookie too — two copies of cookie policy is how one of them ends up without
 * `httpOnly`.
 */
export function setAuthCookie(
  response: NextResponse,
  token: string,
  maxAge: number = AUTH_COOKIE_MAX_AGE
): void {
  // Desktop: loopback HTTP must not require the Secure flag (localhost is a
  // trustworthy origin, but the packaged Electron server is plain HTTP).
  const secure = process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false';
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge,
    path: '/',
  });
}

/** Clears the session cookie (logout, or rejecting a stale session). */
export function clearAuthCookie(response: NextResponse): void {
  setAuthCookie(response, '', 0);
}
