import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_EXPIRES_IN = '7d';

/**
 * JWT secret must always come from the environment — never from a hardcoded
 * fallback. The desktop runtime injects a per-install secret; the dev/server
 * deployment provides one via .env. Fail closed if it is missing.
 */
function getJwtSecret(): string {
  // Removed the old (insecure) hardcoded fallback.
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return secret;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  /**
   * Branch the user was operating in when the token was issued. This is a
   * *preference*, never an authority: `requireAuth` re-reads the live user row
   * on every request and re-validates this value, so editing or replaying a
   * token cannot widen a user's scope. `null` for an admin viewing the whole
   * business.
   */
  branchId?: string | null;
}

export function generateToken(payload: {
  userId: string;
  email: string;
  role: string;
  branchId?: string | null;
}): string {
  // jwt.sign drops `undefined` values, so normalise to an explicit null to keep
  // "no branch selected" distinguishable from an old token with no claim.
  return jwt.sign(
    { ...payload, branchId: payload.branchId ?? null },
    getJwtSecret(),
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as JWTPayload;
  } catch {
    return null;
  }
}

export function getTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}