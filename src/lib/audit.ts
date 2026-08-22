import { db } from '@/lib/db';
import type { Prisma } from '@prisma/client';

/**
 * Audit logging helper — single source of truth for the audit trail (Rule 18).
 *
 * Every mutating API route should record significant actions here.
 * Failures are swallowed deliberately: audit logging must never break the
 * primary operation it is observing.
 *
 * @param tx      Optional Prisma transaction client — pass when called inside
 *                db.$transaction so the log commits atomically with the action.
 */
export async function logAudit(
  entry: {
    userId?: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    details?: string | null;
    ipAddress?: string | null;
  },
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx ?? db;
  try {
    await client.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        details: entry.details ?? null,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (error) {
    console.error('[logAudit] failed to write audit log:', error);
  }
}

/** Extracts the caller IP from standard proxy headers (Netlify/Vercel friendly). */
export function getClientIp(request: Request): string | null {
  return (
    request.headers.get('x-nf-client-connection-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null
  );
}
