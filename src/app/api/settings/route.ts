import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin } from '@/lib/require-auth';
import { logAudit, getClientIp } from '@/lib/audit';
import { purgeRetiredSettings } from '@/lib/server-settings';
import {
  OWNER_ONLY_SETTING_PREFIXES,
  RETIRED_SETTING_KEYS,
  visibleSettingsFor,
  withoutRetiredSettings,
  isRetiredSettingKey,
} from '@/lib/settings-visibility';

// GET /api/settings — fetch settings as key-value pairs.
//
// This is `requireAuth`, not `requireAdmin`, because the POS needs the pharmacy
// name, address and receipt footer to render a receipt, and a salesperson has to
// be able to do that. That breadth is exactly why the query filters: without it
// every sales account also received `remote.currentLink`, the live public ngrok
// tunnel URL. See src/lib/settings-visibility.ts for the rule and the reason it
// is prefix-based rather than a list of known secret keys.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    // Retired keys are removed from the install by the admin who opens Settings.
    // A salesperson hitting the POS must not trigger a DELETE on every request,
    // so the purge is deliberately not part of the non-admin path. The read
    // filter below covers both roles regardless of whether the rows are gone yet.
    if (auth.user!.role === 'admin') {
      await purgeRetiredSettings();
    }

    // Keys belonging to features that no longer exist. Applies to admins too: the
    // client has no field to put them in, so returning one can only become dead
    // weight in the payload and in the localStorage mirror built from it.
    const retired: Prisma.SystemSettingWhereInput = { key: { in: [...RETIRED_SETTING_KEYS] } };

    // Withheld in the DATABASE query rather than filtered out of the result:
    // a sales request should never pull the tunnel URL into server memory, let
    // alone into a response. The exclusion is built from the prefix list as an
    // OR, so adding a second owner-only namespace later is a one-line change
    // here and nowhere else.
    const rows = auth.user!.role === 'admin'
      ? await db.systemSetting.findMany({
          where: { NOT: retired },
          select: { key: true, value: true },
        })
      : await db.systemSetting.findMany({
          where: {
            NOT: {
              OR: [
                ...OWNER_ONLY_SETTING_PREFIXES.map((prefix) => ({
                  key: { startsWith: prefix },
                })),
                retired,
              ],
            },
          },
          select: { key: true, value: true },
        });

    const all: Record<string, string> = {};
    for (const row of rows) {
      all[row.key] = row.value;
    }

    // Second gate on the way out. The query above is the real control; this one
    // means a future edit that loosens the `where` cannot re-open the leak
    // silently, and it keeps the rule in ONE named place
    // (`isOwnerOnlySettingKey`) rather than an inline string comparison. The same
    // belt-and-braces reasoning applies to retired keys: if the query filter is
    // ever dropped, these are still dropped here.
    const settings = withoutRetiredSettings(visibleSettingsFor(all, auth.user!.role === 'admin'));

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

    // Refuse retired keys rather than silently dropping them, so a client still
    // holding a pre-removal localStorage mirror cannot resurrect a dead setting
    // behind the purge. Silently ignoring would leave the owner staring at a save
    // that reported success and changed nothing; rejecting is honest and is
    // unreachable once the client bundle is refetched.
    const rejected = entries
      .map(([key]) => key)
      .filter(isRetiredSettingKey);

    if (rejected.length > 0) {
      return NextResponse.json(
        {
          error: `These settings no longer exist and were not saved: ${rejected.join(', ')}. Reload the page to pick up the current version.`,
        },
        { status: 400 }
      );
    }

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