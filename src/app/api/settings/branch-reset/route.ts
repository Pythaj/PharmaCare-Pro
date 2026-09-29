import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireBranchScope } from '@/lib/require-auth';
import { logAudit, getClientIp } from '@/lib/audit';
import {
  measureResetImpact,
  parseResetScopes,
  describeReset,
  RESET_SCOPES,
  type ResetScope,
  type ResetImpact,
} from '@/lib/branch-reset';

/**
 * GET  /api/settings/branch-reset  → what a reset WOULD change (read-only)
 * POST /api/settings/branch-reset  → apply it
 *
 * Lets an admin put one branch back to a clean slate — quantities back to zero
 * so the shelves can be walked and re-counted — WITHOUT deleting the drug
 * catalogue. See lib/branch-reset for the full rationale and the list of
 * things this can never touch.
 *
 * ## Why the branch comes from the session, never the body
 *
 * The admin picks the branch in the UI, but the value that authorises the
 * reset is the one in the signed session. Accepting a `branchId` from the
 * request body would mean a single crafted call could empty any branch in the
 * business — the exact "clear another shop's data" incident this feature must
 * make impossible. The UI branch and the session branch are cross-checked
 * instead, and a mismatch is refused.
 *
 * ## Why GET is a preview and POST is the real thing
 *
 * The confirmation dialog has to state real numbers ("142 units across 96
 * batches"), and those numbers must not go stale between being shown and being
 * confirmed. GET returns the counts; the client sends back the same scopes plus
 * a typed confirmation phrase, and POST re-measures inside the transaction that
 * writes, so the audit row records what actually happened.
 */

const CONFIRM_PHRASE = 'RESET';

/** Explains each scope in the API's own words so the UI never invents its own copy. */
const SCOPE_LABELS: Record<ResetScope, { label: string; description: string; destructive: boolean }> = {
  stock: {
    label: 'Stock quantities',
    description:
      'Set every batch quantity at this branch back to 0. Batches, prices, batch numbers and expiry dates are all kept — only the counts are cleared.',
    destructive: false,
  },
  sales: {
    label: 'Sales & returns',
    description:
      'Delete this branch’s sales history, including its sale lines and any returns. Customers, drugs and stock quantities are not affected.',
    destructive: true,
  },
  registers: {
    label: 'Day registers',
    description:
      'Delete this branch’s open and closed day summaries so the till starts a fresh register history.',
    destructive: true,
  },
  purchases: {
    label: 'Purchase records',
    description:
      'Delete this branch’s purchase records. Supplier records and drug prices are kept.',
    destructive: true,
  },
};

export async function GET(request: NextRequest) {
  try {
    const auth = await requireBranchScope(request, { admin: true });
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const branchId = auth.scope!.branchId;
    if (!branchId) {
      return NextResponse.json(
        {
          error:
            'Select the branch you want to reset. This tool always works on exactly one shop, so there is nothing to do on "All branches".',
        },
        { status: 400 }
      );
    }

    const impact = await measureResetImpact(db, branchId, RESET_SCOPES);

    // The drug count is reported explicitly and can never be zeroed by any
    // scope — it is the reassurance the admin needs before ticking anything.
    const [products, batches, branch] = await Promise.all([
      db.product.count({ where: { active: true } }),
      db.batch.count({ where: { branchId } }),
      db.branch.findUnique({ where: { id: branchId }, select: { name: true, code: true } }),
    ]);

    return NextResponse.json({
      branchId,
      branchName: branch?.name ?? 'This branch',
      branchCode: branch?.code ?? null,
      impact,
      // Proof, not decoration: this is the number of drugs that will still be
      // on the catalogue after the reset.
      drugsKept: products,
      batchesKept: batches,
      scopes: RESET_SCOPES.map((scope) => ({ scope, ...SCOPE_LABELS[scope] })),
      confirmPhrase: CONFIRM_PHRASE,
    });
  } catch (error) {
    console.error('Branch reset preview error:', error);
    return NextResponse.json({ error: 'Failed to load reset preview' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireBranchScope(request, { admin: true });
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const branchId = auth.scope!.branchId;
    if (!branchId) {
      return NextResponse.json(
        {
          error:
            'Select the branch you want to reset. This tool always works on exactly one shop, so there is nothing to do on "All branches".',
        },
        { status: 400 }
      );
    }

    const body = await request.json();
    const scopes = parseResetScopes(body.scopes);

    if (scopes.length === 0) {
      return NextResponse.json(
        { error: 'Choose at least one thing to clear' },
        { status: 400 }
      );
    }

    // The typed phrase is required for any scope, including the non-destructive
    // one. Zeroing a shop's stock by accident is a full day of re-counting, and
    // a confirm dialog that is free to click through is not a confirmation.
    if (body.confirm !== CONFIRM_PHRASE) {
      return NextResponse.json(
        { error: `Type ${CONFIRM_PHRASE} to confirm this reset` },
        { status: 400 }
      );
    }

    // If the client claims it is resetting a branch other than the one in its
    // session, refuse rather than quietly operating on the session's branch.
    // The UI sends this so a stale branch selector cannot be mistaken for a
    // successful reset of the shop the admin was actually looking at.
    if (body.branchId && body.branchId !== branchId) {
      return NextResponse.json(
        { error: 'The selected branch no longer matches your session. Refresh and try again.' },
        { status: 409 }
      );
    }

    const branch = await db.branch.findUnique({
      where: { id: branchId },
      select: { name: true },
    });

    // One transaction for every selected scope. A reset that half-applied is
    // worse than one that refused outright, and the audit row is written
    // through the same client so the record of the reset cannot be lost to a
    // rollback.
    const result = await db.$transaction(async (tx) => {
      // Measured INSIDE the transaction, immediately before the writes, so the
      // audit entry describes the real outcome rather than the preview the admin
      // was shown a minute ago.
      const impact: ResetImpact = await measureResetImpact(tx, branchId, scopes);

      for (const scope of scopes) {
        switch (scope) {
          case 'stock':
            // `updateMany`, not a loop of updates: one statement for the whole
            // branch. It touches `quantity` ONLY — costPrice, sellingPrice,
            // expiryDate, batchNumber and createdAt are left exactly as they
            // were, so the shelf keeps its identity and its pricing.
            await tx.batch.updateMany({
              where: { branchId },
              data: { quantity: 0 },
            });
            break;

          case 'sales':
            // Returns are removed explicitly rather than leaning on the
            // `Return -> Sale` cascade. SQLite only honours cascades when
            // foreign keys are enabled, so a cascade-dependent delete can
            // silently leave refund rows pointing at sales that no longer exist
            // on one provider and not the other. A `Return` has no branch of its
            // own — it inherits one through its sale — so the boundary has to be
            // expressed through that relation, or a Branch A reset would take
            // Branch B's refunds with it. Sale items then cascade from the sale
            // row itself, and no product row is anywhere in either cascade.
            await tx.return.deleteMany({ where: { sale: { branchId } } });
            await tx.sale.deleteMany({ where: { branchId } });
            break;

          case 'registers':
            await tx.dailySalesRecord.deleteMany({ where: { branchId } });
            break;

          case 'purchases':
            // Batches carry an optional purchaseId. The relation is NOT a
            // cascade, so the driver would refuse this delete while batches
            // still pointed at a purchase being removed. Detaching first keeps
            // the stock rows (and their quantities) exactly where they are.
            await tx.batch.updateMany({
              where: { branchId, purchaseId: { not: null } },
              data: { purchaseId: null },
            });
            await tx.purchase.deleteMany({ where: { branchId } });
            break;
        }
      }

      const details = describeReset(branch?.name ?? 'this branch', scopes, impact);

      await logAudit(
        {
          userId: auth.user!.userId,
          branchId,
          action: 'DELETE',
          entity: 'Branch',
          entityId: branchId,
          details,
          ipAddress: getClientIp(request),
        },
        tx
      );

      return { impact, details };
    });

    return NextResponse.json({
      success: true,
      branchId,
      branchName: branch?.name ?? 'This branch',
      scopes,
      impact: result.impact,
      details: result.details,
    });
  } catch (error) {
    console.error('Branch reset error:', error);
    return NextResponse.json({ error: 'Failed to reset this branch' }, { status: 500 });
  }
}
