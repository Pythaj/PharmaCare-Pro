import { db } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import type { AuditAction, AuditEntity } from '@/lib/audit-actions';

/**
 * Audit logging helper — single source of truth for the audit trail (Rule 18).
 *
 * Every mutating API route should record significant actions here. The action
 * and entity are typed against the canonical vocabulary in lib/audit-actions so
 * a typo can never invent an action the admin audit UI cannot filter for.
 *
 * Failures are swallowed deliberately: audit logging must never break the
 * primary operation it is observing.
 *
 * @param tx      Optional Prisma transaction client — pass when called inside
 *                db.$transaction so the log commits atomically with the action.
 */
export async function logAudit(
  entry: {
    userId?: string | null;
    /**
     * Where the action happened. Optional so existing call sites keep working,
     * but branch-aware routes should pass it — "which shop was this done at" is
     * usually the first question when a figure looks wrong.
     */
    branchId?: string | null;
    action: AuditAction;
    entity: AuditEntity;
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
        branchId: entry.branchId ?? null,
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
