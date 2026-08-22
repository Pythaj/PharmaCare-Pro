import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/require-auth';
import { logAudit, getClientIp } from '@/lib/audit';

// GET /api/settings — fetch all settings as key-value pairs
export async function GET() {
  try {
    const rows = await db.systemSetting.findMany({
      select: { key: true, value: true },
    });

    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }

    return NextResponse.json({ settings });
  } catch (error) {
    console.error('[GET /api/settings]', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

// PUT /api/settings — upsert all provided key-value pairs (admin only)
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json();
    const incoming: Record<string, string> = body.settings;

    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return NextResponse.json({ error: 'Invalid payload: expected { settings: Record<string, string> }' }, { status: 400 });
    }

    const entries = Object.entries(incoming);

    await Promise.all(
      entries.map(([key, value]) =>
        db.systemSetting.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        }),
      ),
    );

    await logAudit({
      userId: auth.user!.userId,
      action: 'UPDATE',
      entity: 'SystemSetting',
      details: `Saved ${entries.length} system setting${entries.length !== 1 ? 's' : ''}`,
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PUT /api/settings]', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}