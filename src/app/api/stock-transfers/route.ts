import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireBranchScope } from '@/lib/require-auth';
import { logAudit, getClientIp } from '@/lib/audit';
import { ValidationError } from '@/lib/api-error';
import { BranchConfigurationError } from '@/lib/branches';
import {
  TransferValidationError,
  assertAvailability,
  formatTransferReference,
  isTransferStatus,
  parseTransferLines,
  resolveFromBranchId,
  sumByBatch,
  transferScopeWhere,
} from '@/lib/stock-transfer';
import { committedQuantityByBatch } from '@/lib/stock-transfer-server';

/** Largest number of lines one transfer may carry. */
const MAX_LINES = 200;

/**
 * GET /api/stock-transfers
 *
 * Lists transfers involving the session's branch, in either direction. A shop
 * needs to see both what it is shipping out and what is arriving, so visibility
 * is an OR over `fromBranchId`/`toBranchId` rather than a single-side filter.
 */
export async function GET(request: NextRequest) {
  const auth = await requireBranchScope(request, { admin: true });
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200);

    if (statusParam && !isTransferStatus(statusParam)) {
      return NextResponse.json(
        { error: `Unknown status "${statusParam}"` },
        { status: 400 }
      );
    }

    const transfers = await db.stockTransfer.findMany({
      where: {
        ...transferScopeWhere(auth.scope!),
        ...(statusParam ? { status: statusParam } : {}),
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        fromBranch: { select: { id: true, name: true, code: true } },
        toBranch: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        lines: {
          include: {
            product: { select: { id: true, name: true, unit: true } },
            sourceBatch: {
              select: { id: true, batchNumber: true, expiryDate: true },
            },
            destBatch: {
              select: { id: true, batchNumber: true, quantity: true },
            },
          },
        },
      },
    });

    return NextResponse.json({ transfers });
  } catch (error) {
    console.error('Stock transfer list error:', error);
    return NextResponse.json({ error: 'Failed to fetch transfers' }, { status: 500 });
  }
}

/**
 * POST /api/stock-transfers
 *
 * Raises a transfer. NO STOCK MOVES HERE — a request is a request, and the
 * shelves must not change until someone completes it. Availability is checked
 * now anyway so a counter clerk is not told "approved" and then contradicted at
 * dispatch, and the same check runs again inside the completion transaction.
 */
export async function POST(request: NextRequest) {
  const auth = await requireBranchScope(request, { admin: true });
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const userId = auth.user!.userId;

  try {
    const body = await request.json();
    const { toBranchId, notes, status = 'pending', items } = body;

    if (!isTransferStatus(status)) {
      return NextResponse.json({ error: 'Invalid transfer status' }, { status: 400 });
    }
    if (status === 'completed' || status === 'approved') {
      // A transfer cannot be born already dispatched: the approval is a
      // separate, attributable act.
      return NextResponse.json(
        { error: 'A transfer must be raised as pending, then approved or completed' },
        { status: 400 }
      );
    }

    const lines = parseTransferLines(items);
    if (lines.length > MAX_LINES) {
      return NextResponse.json(
        { error: `A transfer may contain at most ${MAX_LINES} items` },
        { status: 400 }
      );
    }

    const fromBranchId = resolveFromBranchId(body.fromBranchId, auth.scope!);
    if (!fromBranchId) {
      return NextResponse.json(
        { error: 'A source branch is required' },
        { status: 400 }
      );
    }
    if (typeof toBranchId !== 'string' || !toBranchId.trim()) {
      return NextResponse.json({ error: 'A destination branch is required' }, { status: 400 });
    }
    if (toBranchId.trim() === fromBranchId) {
      return NextResponse.json(
        { error: 'Source and destination branches must be different' },
        { status: 400 }
      );
    }

    // Both branches must be real and active. A deactivated branch is a closed
    // shop: it has no shelf to receive stock and no staff to authorise it.
    const branches = await db.branch.findMany({
      where: { id: { in: [fromBranchId, toBranchId.trim()] } },
      select: { id: true, name: true, code: true, active: true },
    });
    const from = branches.find((b) => b.id === fromBranchId);
    const to = branches.find((b) => b.id === toBranchId.trim());
    if (!from || !to || !from.active || !to.active) {
      return NextResponse.json(
        { error: 'Both branches must be active' },
        { status: 400 }
      );
    }

    // Collapse duplicate batches BEFORE checking stock, so two lines drawing on
    // one batch are validated as the single total they really are.
    const wanted = sumByBatch(lines);
    const batchIds = [...wanted.keys()];

    const batches = await db.batch.findMany({
      where: { id: { in: batchIds } },
      select: {
        id: true,
        branchId: true,
        productId: true,
        batchNumber: true,
        quantity: true,
        costPrice: true,
        sellingPrice: true,
        expiryDate: true,
        product: { select: { name: true } },
      },
    });

    const batchById = new Map(batches.map((b) => [b.id, b]));
    const committed = await committedQuantityByBatch(db, batchIds);

    for (const [batchId, requested] of wanted) {
      const batch = batchById.get(batchId);
      if (!batch) {
        throw new ValidationError('One of the selected batches no longer exists');
      }
      if (batch.branchId !== fromBranchId) {
        throw new ValidationError(
          `"${batch.product.name}" (batch ${batch.batchNumber}) is not held by ${from.name}. ` +
            'Stock can only be transferred out of the branch that holds it.'
        );
      }
      assertAvailability({
        batch,
        requested,
        committed: committed.get(batchId) ?? 0,
        productName: batch.product.name,
      });
    }

    // Per-branch sequential reference, e.g. TRF-MAIN-0001. Derived from the count
    // of this branch's existing transfers rather than a counter row, so two
    // admins raising transfers at once cannot collide on a stale number; the
    // unique constraint is the real guard and the P2002 retry below is the
    // backstop.
    const existingCount = await db.stockTransfer.count({ where: { fromBranchId } });
    let reference = formatTransferReference(from.code, existingCount + 1);
    for (let attempt = 0; attempt < 5; attempt++) {
      const clash = await db.stockTransfer.findUnique({ where: { reference } });
      if (!clash) break;
      reference = formatTransferReference(from.code, existingCount + 2 + attempt);
    }

    const transfer = await db.stockTransfer.create({
      data: {
        reference,
        fromBranchId,
        toBranchId: to!.id,
        status,
        notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
        createdById: userId,
        // One line per distinct batch, carrying the summed quantity.
        lines: {
          create: lines.map((line) => {
            const batch = batchById.get(line.batchId)!;
            return {
              productId: batch.productId,
              sourceBatchId: batch.id,
              quantity: wanted.get(batch.id)!,
              // Snapshot the source's cost now. A later price edit at the
              // source must not rewrite what this movement was worth.
              unitCost: Number(batch.costPrice),
            };
          }),
        },
      },
      include: {
        fromBranch: { select: { id: true, name: true, code: true } },
        toBranch: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, name: true } },
        lines: {
          include: {
            product: { select: { id: true, name: true, unit: true } },
            sourceBatch: {
              select: { id: true, batchNumber: true, expiryDate: true },
            },
          },
        },
      },
    });

    await logAudit({
      userId,
      action: 'CREATE',
      entity: 'StockTransfer',
      entityId: transfer.id,
      details: `Raised transfer ${transfer.reference}: ${transfer.lines.length} item(s) from ${from.name} to ${to!.name}`,
      branchId: fromBranchId,
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ transfer }, { status: 201 });
  } catch (error) {
    if (error instanceof TransferValidationError || error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof BranchConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Stock transfer create error:', error);
    return NextResponse.json({ error: 'Failed to raise transfer' }, { status: 500 });
  }
}
