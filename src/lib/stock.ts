/**
 * Batch stock mutation — the single source of truth for taking units off a
 * shelf and putting them back (Rule 18).
 *
 * The decrement here is a guarded `updateMany` (quantity >= n), never a
 * read-then-write. `lib/stock-transfer.ts` already guarded its movement for
 * exactly this reason, but `POST /api/sales` did not: it checked
 * `batch.quantity` and then issued an unguarded `{ decrement: n }`. Between those
 * two statements a second till can take the same units, and both decrements
 * succeed — the classic last-batch oversell, which is unrecoverable because the
 * stock physically left the building.
 *
 * With the guard, the loser of the race matches zero rows and the whole sale
 * transaction rolls back instead of recording stock the pharmacy does not have.
 */

import { ConflictError, ValidationError } from '@/lib/api-error';

/**
 * The minimal transaction surface these helpers need. Typed structurally (not
 * with Prisma's generated types) so the rules stay importable from anywhere a
 * test can reach them without a generated client.
 */
export interface BatchStockTx {
  batch: {
    updateMany(args: {
      where: { id: string; quantity: { gte: number } };
      data: { quantity: { decrement: number } };
    }): Promise<{ count: number }>;
    update(args: {
      where: { id: string };
      data: { quantity: { increment: number } | { decrement: number } };
    }): Promise<unknown>;
    findFirst(args: {
      where: { id: string; branchId: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
}

export interface DecrementStockInput {
  batchId: string;
  quantity: number;
  /** Operator-facing name for the batch, e.g. its batch number. */
  label: string;
  /**
   * When true the batch is allowed to go below zero (a backorder). The guard is
   * then omitted, because there is nothing to be short of.
   */
  allowNegative?: boolean;
}

/**
 * Removes `quantity` units from a batch, failing the caller's transaction if the
 * units are not actually there.
 *
 * @throws ConflictError (409) when another transaction took the units first.
 *   This is a real, retryable business condition rather than a bad request: the
 *   customer is owed stock, the database just says it has gone.
 */
export async function decrementBatchStock(
  tx: BatchStockTx,
  { batchId, quantity, label, allowNegative = false }: DecrementStockInput
): Promise<void> {
  if (quantity <= 0) return;

  if (allowNegative) {
    await tx.batch.update({
      where: { id: batchId },
      data: { quantity: { decrement: quantity } },
    });
    return;
  }

  const debited = await tx.batch.updateMany({
    where: { id: batchId, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } },
  });

  if (debited.count === 0) {
    throw new ConflictError(
      `Stock for batch "${label}" is no longer available — it was sold or moved while this sale was being entered. Nothing was charged.`
    );
  }
}

export interface RestorableLine {
  batchId: string | null;
  quantity: number;
}

/**
 * Moves units on or off the batches they came off.
 *
 * `direction` is `1` when a return is approved (its units go back on the shelf)
 * and `-1` when an approved return is voided (they go off again). A void is
 * deliberately NOT guarded: those units were counted as present when the refund
 * was approved and may well have been sold since, in which case the shelf really
 * is short — refusing the void would leave the books permanently out by that
 * amount, while decrementing keeps the records honest.
 *
 * `ownerBranchId` is REQUIRED rather than optional so that adding a new caller
 * cannot silently skip the check. A refund is the one movement that credits
 * stock without the caller naming a batch of its own: `batchId` comes from the
 * original sale item, so nothing about the request is checked against the shelf
 * being credited. The branch is therefore re-asserted here, in the one function
 * that performs the credit, instead of being trusted at each call site.
 *
 * A line whose batch is missing, foreign, or carries no quantity is skipped and
 * logged rather than thrown: the customer is owed the refund either way, and
 * refusing the refund because one line of legacy data is malformed would keep
 * the money in the till. This exists for data written before sale creation was
 * branch-checked — without it, refunding such a sale would credit a foreign
 * branch's shelf, inventing inventory in a shop that never held the goods.
 */
export async function restoreBatchStock(
  tx: BatchStockTx,
  lines: readonly RestorableLine[],
  ownerBranchId: string,
  context: string,
  direction: 1 | -1 = 1
): Promise<void> {
  for (const line of lines) {
    if (!line.batchId || line.quantity <= 0) continue;

    const owned = await tx.batch.findFirst({
      where: { id: line.batchId, branchId: ownerBranchId },
      select: { id: true },
    });
    if (!owned) {
      console.error(
        `[restoreBatchStock] ${context}: batch ${line.batchId} is not owned by branch ` +
          `${ownerBranchId} — skipped ${direction === 1 ? 'restoring' : 're-removing'} ` +
          `${line.quantity} unit(s). Pre-existing cross-branch data; reconcile manually.`
      );
      continue;
    }

    await tx.batch.update({
      where: { id: line.batchId },
      data: {
        quantity: direction === 1
          ? { increment: line.quantity }
          : { decrement: line.quantity },
      },
    });
  }
}

/**
 * True when two branch ids name the same shop. Used to reject a transfer whose
 * source and destination are one branch — a movement with no destination would
 * debit a batch and credit the very batch it debited, leaving the ledger saying
 * the goods moved while the shelf never changed.
 */
export function isSameBranch(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && a === b;
}

/**
 * @throws ValidationError (400) when a movement names the same branch twice.
 */
export function assertDifferentBranches(
  fromBranchId: string,
  toBranchId: string,
  subject = 'A transfer'
): void {
  if (isSameBranch(fromBranchId, toBranchId)) {
    throw new ValidationError(`${subject} cannot have the same source and destination branch`);
  }
}