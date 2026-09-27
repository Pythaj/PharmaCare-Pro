import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/require-auth';
import { logAudit, getClientIp } from '@/lib/audit';
import { isValidBranchCode, normalizeBranchCode } from '@/lib/branches';

/**
 * GET /api/branches — the branch list.
 *
 * Admin only. A salesperson is pinned to a single branch, so the full list is
 * both useless to them and a small disclosure: branch names, codes and addresses
 * together are a map of the business. Their own branch name travels on their
 * user record instead, so the POS and header can still label it.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const branches = await db.branch.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: {
        _count: {
          select: {
            users: true,
            batches: true,
            sales: true,
          },
        },
      },
    });

    return NextResponse.json({
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        code: b.code,
        address: b.address,
        phone: b.phone,
        active: b.active,
        createdAt: b.createdAt,
        staffCount: b._count.users,
        batchCount: b._count.batches,
        saleCount: b._count.sales,
      })),
    });
  } catch (error) {
    console.error('Branches list error:', error);
    return NextResponse.json({ error: 'Failed to fetch branches' }, { status: 500 });
  }
}

/** POST /api/branches — create a branch. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'Branch name is required' }, { status: 400 });
    }
    if (name.length > 120) {
      return NextResponse.json(
        { error: 'Branch name must be 120 characters or fewer' },
        { status: 400 }
      );
    }

    const code = normalizeBranchCode(typeof body.code === 'string' ? body.code : '');
    if (!isValidBranchCode(code)) {
      return NextResponse.json(
        { error: 'Branch code must be 2-10 letters or numbers (e.g. MAIN, ACCRA)' },
        { status: 400 }
      );
    }

    // The code is baked into every invoice number, so a duplicate would make
    // two branches issue identical receipts.
    const existing = await db.branch.findUnique({ where: { code } });
    if (existing) {
      return NextResponse.json(
        { error: `Branch code "${code}" is already in use` },
        { status: 409 }
      );
    }

    const branch = await db.branch.create({
      data: {
        name,
        code,
        address: typeof body.address === 'string' && body.address.trim() ? body.address.trim() : null,
        phone: typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null,
        active: body.active === undefined ? true : body.active === true,
      },
    });

    await logAudit({
      userId: auth.user!.userId,
      branchId: branch.id,
      action: 'CREATE',
      entity: 'Branch',
      entityId: branch.id,
      details: `Created branch "${branch.name}" (${branch.code})`,
      ipAddress: getClientIp(request),
    });

    return NextResponse.json(branch, { status: 201 });
  } catch (error) {
    console.error('Branch create error:', error);
    return NextResponse.json({ error: 'Failed to create branch' }, { status: 500 });
  }
}
