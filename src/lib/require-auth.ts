import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromHeader, JWTPayload } from '@/lib/auth';

export interface AuthResult {
  success: boolean;
  user?: JWTPayload;
  error?: string;
  status?: number;
}

export async function requireAuth(request: NextRequest): Promise<AuthResult> {
  const authHeader = request.headers.get('authorization');
  const cookieToken = request.cookies.get('auth_token')?.value;
  const token = getTokenFromHeader(authHeader) || cookieToken;

  if (!token) {
    return { success: false, error: 'Authentication required', status: 401 };
  }

  const payload = verifyToken(token);
  if (!payload) {
    return { success: false, error: 'Invalid or expired token', status: 401 };
  }

  return { success: true, user: payload };
}

export async function requireAdmin(request: NextRequest): Promise<AuthResult> {
  const auth = await requireAuth(request);
  if (!auth.success) {
    return auth;
  }

  if (auth.user?.role !== 'admin') {
    return { success: false, error: 'Admin access required', status: 403 };
  }

  return auth;
}

export async function getAuthUser(request: NextRequest): Promise<JWTPayload | null> {
  const authHeader = request.headers.get('authorization');
  const cookieToken = request.cookies.get('auth_token')?.value;
  const token = getTokenFromHeader(authHeader) || cookieToken;

  if (!token) return null;
  return verifyToken(token);
}