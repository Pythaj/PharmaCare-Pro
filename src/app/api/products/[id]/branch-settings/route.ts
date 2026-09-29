import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireBranchScope } from '@/lib/require-auth';
import { parseReorderLevel, parseMoney } from '@/lib/product-input';
import { logAudit, getClientIp } from '@/lib/audit';

/**
 * PUT /api/products/[id]/branch-settings
 *
 * Sets — or clears — this branch's override of the catalogue fields that
 * legitimately differ per shop. The chain-wide values live on `Product` and are
 * edited through `PUT /api/products/[id]`; this endpoint only ever touches the
 * row in `BranchProductSetting` for the branch in the session.
 *
 * ## Why a separate endpoint rather than a flag on the product update
 *
 * `PUT /api/products/[id]` has no branch scope at all: it is the chain-wide
 * editor, and that is correct for a name or a category. Overloading it with
 * `branchOverrides: {...}` would mean one request could quietly change the
 * global price AND one branch's threshold, and a client bug in the edit form
 * would move every shop at once. Separate resource, separate route, separate
 * permission check.
 *
 * ## Why the branch is required
 *
 * There is no such thing as an override of "all branches" — the consolidated
 * view has no local shelf to disagree with. So this refuses without a selected
 * branch, the same rule the batches, sales and daily-register routes already
 * enforce, rather than silently applying the change everywhere.
 *
 * ## Clearing an override
 *
 * An explicit `null` writes SQL NULL, which is the documented "inherit the
 * chain-wide value" state. This is deliberately distinct from `0`: 0 is a real
 * threshold meaning "never flag as low here", while null means "whatever the
 * chain-wide setting says". Collapsing them would make it impossible to turn a
 * local alert off without also changing it for everyone.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const auth = await requireBranchScope(request, { admin: true });
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const branchId = auth.scope!.branchId;
    if (!branchId) {
      return NextResponse.json(
        {
          error:
            'Select a branch first. Branch settings apply to one shop — to change the value for every branch, edit the product itself.',
        },
        { status: 400 }
      );
    }

    const product = await db.product.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const body = await request.json();

    // Only keys actually present are touched, so a partial save (say, just the
    // threshold) cannot blank out a price the admin did not mean to change.
    const data: {
      reorderLevel?: number | null;
      sellingPrice?: number | null;
      costPrice?: number | null;
    } = {};

    if (body.reorderLevel !== undefined) {
      if (body.reorderLevel === null) {
        data.reorderLevel = null;
      } else {
        const parsed = parseReorderLevel(body.reorderLevel, 0);
        if (!parsed.ok) {
          return NextResponse.json({ error: parsed.error }, { status: 400 });
        }
        data.reorderLevel = parsed.value;
      }
    }

    if (body.sellingPrice !== undefined) {
      if (body.sellingPrice === null) {
        data.sellingPrice = null;
      } else {
        const parsed = parseMoney(body.sellingPrice, 'Selling price', 0);
        if (!parsed.ok) {
          return NextResponse.json({ error: parsed.error }, { status: 400 });
        }
        data.sellingPrice = parsed.value;
      }
    }

    if (body.costPrice !== undefined) {
      if (body.costPrice === null) {
        data.costPrice = null;
      } else {
        const parsed = parseMoney(body.costPrice, 'Cost price', 0);
        if (!parsed.ok) {
          return NextResponse.json({ error: parsed.error }, { status: 400 });
        }
        data.costPrice = parsed.value;
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: 'Provide at least one of reorderLevel, sellingPrice or costPrice' },
        { status: 400 }
      );
    }

    // Upsert keyed on (productId, branchId) — the compound unique. Two
    // concurrent saves for the same branch converge on one row instead of
    // racing to create duplicates.
    const saved = await db.branchProductSetting.upsert({
      where: { productId_branchId: { productId: id, branchId } },
      create: { productId: id, branchId, ...data },
      update: data,
      select: { productId: true, reorderLevel: true, sellingPrice: true, costPrice: true },
    });

    // A row whose every column is back to NULL carries no information and would
    // only ever be joined for nothing, so clear it out rather than leaving a
    // husk that reads as "this branch has custom settings".
    if (
      saved.reorderLevel === null &&
      saved.sellingPrice === null &&
      saved.costPrice === null
    ) {
      await db.branchProductSetting.delete({
        where: { productId_branchId: { productId: id, branchId } },
      });
    }

    const cleared = Object.entries(data)
      .filter(([, value]) => value === null)
      .map(([field]) => field);

    await logAudit({
      userId: auth.user!.userId,
      branchId,
      action: 'UPDATE',
      entity: 'Product',
      entityId: id,
      details: `Set branch settings for "${product.name}" at ${auth.branch?.name ?? 'this branch'}${
        cleared.length > 0 ? ` (reset to chain-wide: ${cleared.join(', ')})` : ''
      }`,
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ success: true, branchId, settings: saved });
  } catch (error) {
    console.error('Branch product settings error:', error);
    return NextResponse.json(
      { error: 'Failed to save branch settings' },
      { status: 500 }
    );
  }
}
