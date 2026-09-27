import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireBranchScope } from '@/lib/require-auth';
import { logAudit, getClientIp } from '@/lib/audit';
import { completeTransfer } from '@/lib/stock-transfer-server';
import {
  TransferValidationError,
  canTransition,
  isTerminal,
  isTransferAction,
  targetStatusForAction,
  transferScopeWhere,
  transferTouchesBranch,
} from '@/lib/stock-transfer';

/** Audit action recorded for each transfer action. */
const AUDIT_FOR_ACTION = {
  approve: 'TRANSFER_APPROVE',
  complete: 'TRANSFER_COMPLETE',
  reject: 'TRANSFER_REJECT',
  cancel: 'UPDATE',
} as const;

const include = {
  fromBranch: { select: { id: true, name: true, code: true } },
  toBranch: { select: { id: true, name: true, code: true } },
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  lines: {
    include: {
      product: { select: { id: true, name: true, unit: true } },
      sourceBatch: { select: { id: true, batchNumber: true, expiryDate: true } },
      destBatch: { select: { id: true, batchNumber: true, quantity: true } },
    },
  },
} as const;

/**
 * GET /api/stock-transfers/[id]
 *
 * Visible to either party. A transfer is a joint document: the sending branch
 * needs it to know what left, the receiving branch needs it to know what should
 * be arriving, and a one-sided check would lock out whichever side did not
 * create it.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireBranchScope(request, { admin: true });
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await params;
    const transfer = await db.stockTransfer.findFirst({
      where: { id, ...transferScopeWhere(auth.scope!) },
      include,
    });

    if (!transfer) {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }

    return NextResponse.json({ transfer });
  } catch (error) {
    console.error('Stock transfer detail error:', error);
    return NextResponse.json({ error: 'Failed to fetch transfer' }, { status: 500 });
  }
}

/**
 * PATCH /api/stock-transfers/[id] — approve / complete / reject / cancel.
 *
 * Only `complete` moves stock. `approve`, `reject` and `cancel` are bookkeeping,
 * so a rejected or cancelled transfer leaves both shelves untouched by
 * construction. Terminal statuses are refused rather than silently ignored, so a
 * double-dispatch returns a clear error instead of quietly doing nothing while
 * the caller believes the goods moved.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireBranchScope(request, { admin: true });
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const userId = auth.user!.userId;

  try {
    const { id } = await params;
    const body = await request.json();
    const { action, notes } = body;

    if (!isTransferAction(action)) {
      return NextResponse.json(
        { error: 'Action must be one of: approve, complete, reject, cancel' },
        { status: 400 }
      );
    }
    const target = targetStatusForAction(action);

    const existing = await db.stockTransfer.findFirst({
      where: { id, ...transferScopeWhere(auth.scope!) },
      include: {
        fromBranch: { select: { name: true } },
        toBranch: { select: { name: true } },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }

    // Defence in depth: findFirst already filtered by scope, but the two-sided
    // predicate is easy to get subtly wrong, so the ownership question is asked
    // again explicitly before anything is written.
    if (!transferTouchesBranch(existing, auth.scope!)) {
      return NextResponse.json(
        { error: 'That transfer does not involve your branch' },
        { status: 403 }
      );
    }

    if (isTerminal(existing.status)) {
      return NextResponse.json(
        { error: `This transfer is already ${existing.status} and cannot change` },
        { status: 400 }
      );
    }
    if (!canTransition(existing.status, target)) {
      return NextResponse.json(
        { error: `Cannot ${action} a transfer that is ${existing.status}` },
        { status: 400 }
      );
    }

    // Only the SENDING branch can cancel, and only before the goods are
    // approved. A receiving branch that wants to refuse does so by rejecting,
    // which leaves a different and auditable trail.
    if (action === 'cancel' && auth.scope!.branchId && existing.fromBranchId !== auth.scope!.branchId) {
      return NextResponse.json(
        { error: 'Only the sending branch can cancel a transfer' },
        { status: 403 }
      );
    }

    const result = await db.$transaction(async (tx) => {
      if (target === 'completed') {
        // Re-read inside the transaction so the guarded decrement sees the
        // quantity at the moment of the write.
        const moved = await completeTransfer(tx, id, userId);
        await tx.stockTransfer.update({
          where: { id },
          data: {
            notes:
              typeof notes === 'string' && notes.trim()
                ? notes.trim()
                : existing.notes,
          },
        });
        return moved;
      }

      await tx.stockTransfer.update({
        where: { id },
        data: {
          status: target,
          // Stamped on approval so the record names who authorised the movement.
          ...(target === 'approved' ? { approvedById: userId, approvedAt: new Date() } : {}),
          notes:
            typeof notes === 'string' && notes.trim() ? notes.trim() : existing.notes,
        },
      });

      return {
        reference: existing.reference,
        fromBranch: existing.fromBranch.name,
        toBranch: existing.toBranch.name,
        itemCount: 0,
        totalUnits: 0,
      };
    });

    const verb =
      target === 'completed' ? 'completed' : target === 'rejected' ? 'rejected' : target;

    await logAudit({
      userId,
      action: AUDIT_FOR_ACTION[action],
      entity: 'StockTransfer',
      entityId: id,
      details:
        target === 'completed'
          ? `Completed transfer ${result.reference}: ${result.itemCount} item(s), ${result.totalUnits} unit(s) moved from ${result.fromBranch} to ${result.toBranch}`
          : `Transfer ${result.reference} ${verb} (${result.fromBranch} -> ${result.toBranch})`,
      // Attributed to the SENDING branch: it is the branch whose stock left, so
      // it is the trail that answers "what did we ship?".
      branchId: existing.fromBranchId,
      ipAddress: getClientIp(request),
    });

    const updated = await db.stockTransfer.findFirst({ where: { id }, include });
    return NextResponse.json({ transfer: updated });
  } catch (error) {
    if (error instanceof TransferValidationError) {
      // Stock moved out from under the transfer, or a line's batch is gone.
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Stock transfer update error:', error);
    return NextResponse.json({ error: 'Failed to update transfer' }, { status: 500 });
  }
}
