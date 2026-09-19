import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/require-auth';
import { getClientIp } from '@/lib/audit';
import { logAudit } from '@/lib/audit';

const KEY = 'remote.currentLink';

// GET /api/remote/link — current public tunnel link (admin only).
// Kept out of the public /api/settings feed so the link is never readable by
// sales accounts — Remote Access is strictly an owner feature.
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const row = await db.systemSetting.findUnique({ where: { key: KEY } });
    return NextResponse.json({ url: row?.value ?? null });
  } catch (error) {
    console.error('[GET /api/remote/link]', error);
    return NextResponse.json({ error: 'Failed to fetch remote link' }, { status: 500 });
  }
}

// PUT /api/remote/link — persist/sync the live tunnel URL (admin only).
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const body = await request.json();
    const url = typeof body?.url === 'string' ? body.url.trim() : '';

    await db.systemSetting.upsert({
      where: { key: KEY },
      update: { value: url },
      create: { key: KEY, value: url },
    });

    await logAudit({
      userId: auth.user!.userId,
      action: 'UPDATE',
      entity: 'SystemSetting',
      details: url ? 'Synced live Remote Access link' : 'Cleared Remote Access link',
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PUT /api/remote/link]', error);
    return NextResponse.json({ error: 'Failed to save remote link' }, { status: 500 });
  }
}