import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/require-auth';
import { logAudit, getClientIp } from '@/lib/audit';
import { isValidBranchCode, normalizeBranchCode } from '@/lib/branches';
import { seedCatalogueForAllBranches } from '@/lib/catalogue-seeding';

/**
 * PUT /api/branches/[id] — rename, re-code, or (de)activate a branch.
 *
 * Deactivating is deliberately NOT deletion: a branch owns sales history,
 * stock batches and staff. Deleting it would either cascade away real money
 * records or leave them dangling. The codebase already applies this rule to
 * products and users, and a branch outranks both — it is the frame around the
 * whole ledger.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await params;
    const body = await request.json();

    const branch = await db.branch.findUnique({ where: { id } });
    if (!branch) {
      return NextResponse.json({ error: 'Branch not found' }, { status: 404 });
    }

    const data: Record<string, unknown> = {};

    if (body.name !== undefined) {
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
      data.name = name;
    }

    if (body.code !== undefined) {
      const code = normalizeBranchCode(typeof body.code === 'string' ? body.code : '');
      if (!isValidBranchCode(code)) {
        return NextResponse.json(
          { error: 'Branch code must be 2-10 letters or numbers (e.g. MAIN, ACCRA)' },
          { status: 400 }
        );
      }
      // Changing a code changes future invoice numbers but must not collide
      // with a branch that already issues under it.
      if (code !== branch.code) {
        const clash = await db.branch.findUnique({ where: { code } });
        if (clash) {
          return NextResponse.json(
            { error: `Branch code "${code}" is already in use` },
            { status: 409 }
          );
        }
      }
      data.code = code;
    }

    if (body.address !== undefined) {
      data.address =
        typeof body.address === 'string' && body.address.trim() ? body.address.trim() : null;
    }

    if (body.phone !== undefined) {
      data.phone =
        typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;
    }

    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') {
        return NextResponse.json({ error: 'Active must be true or false' }, { status: 400 });
      }

      // Never let the owner lock themselves out of the only branch, and never
      // silently orphan staff: a deactivated branch must not keep employees
      // assigned to a counter that no longer trades.
      if (!body.active && branch.active) {
        const [staff, batchesWithStock] = await Promise.all([
          db.user.count({ where: { branchId: id, active: true } }),
          // Units on hand, not batch rows: a batch that has been fully sold
          // through is history and should not block closing a shop, while one
          // unit of anything left on the shelf must.
          db.batch.count({ where: { branchId: id, quantity: { gt: 0 } } }),
        ]);

        if (staff > 0) {
          return NextResponse.json(
            {
              error: `Cannot deactivate "${branch.name}": ${staff} active staff member${
                staff !== 1 ? 's are' : ' is'
              } still assigned. Move them to another branch first.`,
            },
            { status: 409 }
          );
        }

        if (batchesWithStock > 0) {
          return NextResponse.json(
            {
              error: `Cannot deactivate "${branch.name}": it still holds stock in ${
                batchesWithStock
              } batch${batchesWithStock !== 1 ? 'es' : ''}. Transfer the stock to another branch first.`,
            },
            { status: 409 }
          );
        }
      }

      data.active = body.active;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const updated = await db.$transaction(async (tx) => {
      const result = await tx.branch.update({ where: { id }, data });

      // Reopening a closed shop must give it a working catalogue, exactly like
      // creating it does. Without this, a branch created inactive (or closed and
      // later reopened) came back with an empty shelf, because its catalogue rows
      // are only seeded for active branches.
      if (result.active && !branch.active) {
        await seedCatalogueForAllBranches(tx);
      }

      return result;
    });

    await logAudit({
      userId: auth.user!.userId,
      // Attributed to the branch being edited, so "what happened to this shop?"
      // is answerable from the branch's own audit trail.
      branchId: id,
      action: 'UPDATE',
      entity: 'Branch',
      entityId: id,
      details:
        typeof data.active === 'boolean' && data.active !== branch.active
          ? `${data.active ? 'Reactivated' : 'Deactivated'} branch "${updated.name}"`
          : `Updated branch "${updated.name}"`,
      ipAddress: getClientIp(request),
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Branch update error:', error);
    return NextResponse.json({ error: 'Failed to update branch' }, { status: 500 });
  }
}

/**
 * DELETE is intentionally not offered. See the note above: a branch holds the
 * frame around sales, stock and staff history, so it can only ever be
 * deactivated.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  await params;
  return NextResponse.json(
    {
      error:
        'Branches cannot be deleted because they hold sales, stock and staff history. Deactivate the branch instead.',
    },
    { status: 405 }
  );
}
