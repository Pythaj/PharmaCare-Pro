/**
 * Server-side orchestration for inter-branch stock transfers.
 *
 * Split from `lib/stock-transfer.ts` on purpose: that module is dependency-free
 * and structurally typed so the RULES can be unit-tested and previewed without a
 * database. This one owns the Prisma transaction bodies, which nothing else
 * should be reaching into — route files export HTTP methods only.
 */

import type { Prisma } from '@prisma/client';
import {
  TransferValidationError,
  UNSETTLED_STATUSES,
  applyTransferStock,
} from '@/lib/stock-transfer';

/** The minimum Prisma surface this module needs, for testability. */
type DbLike = Pick<Prisma.TransactionClient, 'stockTransferLine'>;

/**
 * Units of each batch that are spoken for but not yet moved, keyed by batch id.
 *
 * This has to be a PER-BATCH figure, not a total. A single `aggregate` would
 * collapse every batch into one number, and then checking batch A would subtract
 * batch B's commitments from A's stock — refusing a perfectly valid transfer when
 * two batches are being sent, or letting one through when the commitments
 * happened to fall on other batches. `groupBy` keeps each batch's own figure.
 *
 * Batches with nothing committed are absent from the map; callers read it with
 * `?? 0`.
 *
 * @param excludeTransferId This transfer's own lines, so re-validating a
 *   transfer does not count its own request against itself.
 */
export async function committedQuantityByBatch(
  db: DbLike,
  batchIds: string[],
  excludeTransferId?: string
): Promise<Map<string, number>> {
  const committed = new Map<string, number>();
  if (batchIds.length === 0) return committed;

  const rows = await db.stockTransferLine.groupBy({
    by: ['sourceBatchId'],
    where: {
      sourceBatchId: { in: batchIds },
      transfer: {
        status: { in: [...UNSETTLED_STATUSES] },
        ...(excludeTransferId ? { id: { not: excludeTransferId } } : {}),
      },
    },
    _sum: { quantity: true },
  });

  for (const row of rows) {
    committed.set(row.sourceBatchId, row._sum.quantity ?? 0);
  }
  return committed;
}

/**
 * Moves the stock for a transfer and marks it `completed`.
 *
 * Both sides commit together or not at all: the source is debited, the
 * destination credited, every line stamped with the batch it landed in, and the
 * status set — all in the caller's single transaction. A failure anywhere rolls
 * the whole thing back, so a transfer can never be marked complete while the
 * units are still on the source shelf, or vice versa.
 *
 * Availability is re-checked here (via the guarded decrement) rather than
 * trusted from the create-time check, because units may legitimately have been
 * sold or returned between raising a transfer and completing it.
 */
export async function completeTransfer(
  tx: Prisma.TransactionClient,
  transferId: string,
  userId: string
): Promise<{ reference: string; fromBranch: string; toBranch: string; itemCount: number; totalUnits: number }> {
  const transfer = await tx.stockTransfer.findUnique({
    where: { id: transferId },
    include: {
      fromBranch: { select: { name: true } },
      toBranch: { select: { name: true } },
      lines: {
        include: {
          sourceBatch: {
            select: {
              id: true,
              batchNumber: true,
              productId: true,
              sellingPrice: true,
              expiryDate: true,
            },
          },
        },
      },
    },
  });

  if (!transfer) {
    throw new TransferValidationError('Transfer not found');
  }

  const destBatchBySource = await applyTransferStock(
    tx,
    transfer.toBranchId,
    transfer.lines.map((line) => ({
      sourceBatchId: line.sourceBatchId,
      productId: line.sourceBatch.productId,
      quantity: line.quantity,
      batchNumber: line.sourceBatch.batchNumber,
      // The line's snapshotted cost, not the source batch's current one: a price
      // edit at the source after the transfer was raised must not silently
      // restate what the receiving shop now holds stock at.
      costPrice: Number(line.unitCost),
      sellingPrice: Number(line.sourceBatch.sellingPrice),
      expiryDate: line.sourceBatch.expiryDate,
    }))
  );

  for (const line of transfer.lines) {
    const destBatchId = destBatchBySource.get(line.sourceBatchId);
    if (destBatchId) {
      await tx.stockTransferLine.update({
        where: { id: line.id },
        data: { destBatchId },
      });
    }
  }

  await tx.stockTransfer.update({
    where: { id: transferId },
    data: {
      status: 'completed',
      approvedById: userId,
      approvedAt: new Date(),
      completedAt: new Date(),
    },
  });

  return {
    reference: transfer.reference,
    fromBranch: transfer.fromBranch.name,
    toBranch: transfer.toBranch.name,
    itemCount: transfer.lines.length,
    totalUnits: transfer.lines.reduce((sum, l) => sum + l.quantity, 0),
  };
}
