/**
 * Inter-branch stock transfer rules — single source of truth (Rule 18).
 *
 * WHY A TRANSFER IS NOT JUST A BATCH EDIT
 *
 * A `Batch` is owned by exactly one branch, and that is what stops Branch A
 * selling units that are physically on Branch B's shelf. Moving stock between
 * branches therefore cannot be modelled by pointing `Batch.branchId` at the
 * new owner: it would silently re-attribute every sale that already referenced
 * the batch, and it cannot express a partial movement at all. A transfer debits
 * the source batch and credits a destination batch instead, and the
 * `StockTransfer` row is the document that ties the two sides together.
 *
 * THE RULES THAT MATTER
 *
 *  - Stock moves on `completed` and on nothing else. `pending` and `approved`
 *    are paperwork; until the goods are signed for, both shelves must be exactly
 *    as they were. A transfer that is rejected or cancelled is a null event.
 *  - A line's destination batch is created at COMPLETION, never at request
 *    time. Creating it up front would make the receiving shelf appear to hold
 *    stock that is still in a van.
 *  - Availability is checked against on-hand stock MINUS everything already
 *    committed to other un-finished transfers. Without the second term you can
 *    raise three transfers for the same crate, complete all three, and drive
 *    stock negative — each individual check passed.
 *  - The decrement is a guarded `updateMany` (quantity >= n), not a read then a
 *    write. Between validating and writing, a sale can take the same units; a
 *    compare-then-set would oversell, whereas the guard makes the whole movement
 *    fail instead.
 */

import type { BranchScope } from '@/lib/branches';

/** The only statuses a transfer may ever hold. Mirrors the DB column default. */
export const TRANSFER_STATUSES = [
  'pending',
  'approved',
  'completed',
  'rejected',
  'cancelled',
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export function isTransferStatus(value: unknown): value is TransferStatus {
  return typeof value === 'string' && (TRANSFER_STATUSES as readonly string[]).includes(value);
}

/** Statuses that still hold a claim on source stock (i.e. have not settled). */
export const UNSETTLED_STATUSES: readonly string[] = ['pending', 'approved'];

/** Statuses a transfer can never leave. */
export const TERMINAL_STATUSES: readonly string[] = ['completed', 'rejected', 'cancelled'];

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Allowed status transitions.
 *
 * `complete` is reachable from `pending` as well as `approved` on purpose: a
 * two-step approve-then-dispatch flow is the safe default, but requiring it
 * would leave stock genuinely in transit sitting in `approved` forever if the
 * approver was also the driver. Allowing `pending -> completed` means the slow
 * path still exists and the fast path cannot strand inventory.
 */
const TRANSITIONS: Record<TransferStatus, readonly TransferStatus[]> = {
  pending: ['approved', 'completed', 'rejected', 'cancelled'],
  approved: ['completed', 'cancelled'],
  completed: [],
  rejected: [],
  cancelled: [],
};

export function canTransition(from: string, to: string): boolean {
  if (!isTransferStatus(from) || !isTransferStatus(to)) return false;
  return TRANSITIONS[from].includes(to);
}

/** Actions the API accepts, kept separate from statuses for clearer errors. */
export const TRANSFER_ACTIONS = ['approve', 'complete', 'reject', 'cancel'] as const;
export type TransferAction = (typeof TRANSFER_ACTIONS)[number];

export function isTransferAction(value: unknown): value is TransferAction {
  return typeof value === 'string' && (TRANSFER_ACTIONS as readonly string[]).includes(value);
}

const ACTION_TARGET: Record<TransferAction, TransferStatus> = {
  approve: 'approved',
  complete: 'completed',
  reject: 'rejected',
  cancel: 'cancelled',
};

export function targetStatusForAction(action: TransferAction): TransferStatus {
  return ACTION_TARGET[action];
}

// ---------------------------------------------------------------------------
// Branch scoping
// ---------------------------------------------------------------------------

/**
 * A transfer belongs to BOTH branches, and they need opposite halves of it: the
 * source branch must know what it is losing, the destination must know what is
 * arriving. So visibility is an OR over the two sides rather than a single
 * `branchId` filter — a one-sided filter would hide every inbound delivery from
 * the receiving branch, which is precisely the shop that needs to see it.
 *
 * `null` branchId (the consolidated all-branches view) means no filter at all.
 */
export function transferScopeWhere(scope: BranchScope): Record<string, unknown> {
  if (!scope.branchId) return {};
  return {
    OR: [{ fromBranchId: scope.branchId }, { toBranchId: scope.branchId }],
  };
}

/** True when the session's branch is on either side of this transfer. */
export function transferTouchesBranch(
  transfer: { fromBranchId: string; toBranchId: string },
  scope: BranchScope
): boolean {
  if (!scope.branchId) return true;
  return transfer.fromBranchId === scope.branchId || transfer.toBranchId === scope.branchId;
}

/**
 * Where stock may be shipped FROM, given the session.
 *
 * A branch-scoped admin can only dispatch out of the branch they are standing
 * in. That is deliberate: a transfer is the one operation whose `from` is a
 * business decision rather than a bookkeeping label, so the branch whose shelf
 * is being emptied should be the one the operator is actually looking at. An
 * admin in the consolidated "all branches" view may name both sides freely,
 * because that is the owner's whole-business view.
 */
export function resolveFromBranchId(requested: unknown, scope: BranchScope): string | null {
  const wanted = typeof requested === 'string' ? requested.trim() : '';
  if (scope.branchId) {
    // A scoped session may only ship from its own branch, whatever it asked for.
    return scope.branchId;
  }
  return wanted || null;
}

// ---------------------------------------------------------------------------
// Line validation (pure, so it is unit-testable without a database)
// ---------------------------------------------------------------------------

export interface TransferLineInput {
  batchId: unknown;
  quantity: unknown;
}

export interface ParsedTransferLine {
  batchId: string;
  quantity: number;
}

export class TransferValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferValidationError';
  }
}

/**
 * Shape-checks the request body. Deliberately does NOT check stock levels —
 * that needs the database and is done in the route, because it must be
 * re-checked inside the completion transaction anyway.
 */
export function parseTransferLines(raw: unknown): ParsedTransferLine[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new TransferValidationError('A transfer must contain at least one item');
  }

  return raw.map((item, index) => {
    const line = item as TransferLineInput;
    const batchId = typeof line?.batchId === 'string' ? line.batchId.trim() : '';
    if (!batchId) {
      throw new TransferValidationError(`Item ${index + 1}: a batch must be selected`);
    }
    const quantity = Number(line?.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new TransferValidationError(
        `Item ${index + 1}: quantity must be a positive whole number`
      );
    }
    return { batchId, quantity };
  });
}

/**
 * Collapses lines that draw on the same batch.
 *
 * The stock checks work per batch, so two lines pointing at one batch would each
 * be validated against the full quantity and could pass while together asking
 * for twice what is on the shelf. Summing first is what makes the per-batch
 * check meaningful.
 */
export function sumByBatch(
  lines: ParsedTransferLine[]
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines) {
    totals.set(line.batchId, (totals.get(line.batchId) ?? 0) + line.quantity);
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Transactional stock movement
// ---------------------------------------------------------------------------

/**
 * The minimal transaction surface this module needs. Typed structurally (not
 * with Prisma's generated types) so the rules above stay importable from a
 * client component for previews, and so the module can be reasoned about — and
 * tested — without a live database.
 */
export interface TransferTx {
  batch: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; quantity: true };
    }): Promise<Array<{ id: string; quantity: number }>>;
    /** Guarded decrement: matches only while at least `n` units remain. */
    updateMany(args: {
      where: { id: string; quantity: { gte: number } };
      data: { quantity: { decrement: number } };
    }): Promise<{ count: number }>;
    findFirst(args: {
      where: { productId: string; batchNumber: string; branchId: string };
      select: { id: true; quantity: true };
    }): Promise<{ id: string; quantity: number } | null>;
    create(args: {
      data: {
        productId: string;
        branchId: string;
        batchNumber: string;
        quantity: number;
        costPrice: number | string;
        sellingPrice: number | string;
        expiryDate: Date;
      };
    }): Promise<{ id: string }>;
    update(args: {
      where: { id: string };
      data: { quantity: { increment: number } };
    }): Promise<{ id: string }>;
  };
}

export interface SourceBatchSnapshot {
  id: string;
  branchId: string;
  productId: string;
  batchNumber: string;
  quantity: number;
  costPrice: unknown;
  sellingPrice: unknown;
  expiryDate: Date;
}

export interface AvailabilityInput {
  batch: { id: string; batchNumber: string; quantity: number };
  requested: number;
  committed: number;
  productName: string;
}

/**
 * The check that actually prevents an oversell. Throws with the numbers in the
 * message: a stock screen that says "not enough" without saying how much is
 * there, or how much is already promised, is not actionable at a counter.
 */
export function assertAvailability({
  batch,
  requested,
  committed,
  productName,
}: AvailabilityInput): void {
  const available = batch.quantity - committed;
  if (requested <= available) return;

  if (committed > 0) {
    throw new TransferValidationError(
      `Only ${available} of "${productName}" (batch ${batch.batchNumber}) can be transferred: ` +
        `${batch.quantity} on hand, ${committed} already committed to transfers that have not been completed`
    );
  }
  throw new TransferValidationError(
    `Cannot transfer ${requested} of "${productName}" (batch ${batch.batchNumber}): only ${batch.quantity} on hand`
  );
}

export interface DestinationLine {
  sourceBatchId: string;
  productId: string;
  quantity: number;
  batchNumber: string;
  costPrice: number;
  sellingPrice: number;
  expiryDate: Date;
}

/**
 * Debits the source and credits the destination, atomically.
 *
 * Credit lands on the destination's own batch for the same product and delivery
 * number when one already exists, so repeatedly shipping part of a delivery does
 * not fragment the receiving shelf into a dozen one-unit batches. The unique key
 * is (productId, batchNumber, branchId), which is exactly the lookup used here.
 *
 * @returns the destination batch id per source batch, for `StockTransferLine.destBatchId`.
 */
export async function applyTransferStock(
  tx: TransferTx,
  toBranchId: string,
  lines: DestinationLine[]
): Promise<Map<string, string>> {
  const destBatchBySource = new Map<string, string>();

  for (const line of lines) {
    // Guarded decrement. If the stock went between validation and here, `count`
    // is 0 and the whole transaction rolls back rather than overselling.
    const debited = await tx.batch.updateMany({
      where: { id: line.sourceBatchId, quantity: { gte: line.quantity } },
      data: { quantity: { decrement: line.quantity } },
    });
    if (debited.count === 0) {
      throw new TransferValidationError(
        `Stock for batch ${line.batchNumber} is no longer available — it was sold or moved since this transfer was raised`
      );
    }

    const existing = await tx.batch.findFirst({
      where: {
        productId: line.productId,
        batchNumber: line.batchNumber,
        branchId: toBranchId,
      },
      select: { id: true, quantity: true },
    });

    if (existing) {
      await tx.batch.update({
        where: { id: existing.id },
        data: { quantity: { increment: line.quantity } },
      });
      destBatchBySource.set(line.sourceBatchId, existing.id);
    } else {
      const created = await tx.batch.create({
        data: {
          productId: line.productId,
          branchId: toBranchId,
          batchNumber: line.batchNumber,
          quantity: line.quantity,
          // The cost the SOURCE branch paid is the cost the DESTINATION branch
          // now holds. Copying it keeps the receiving shop's margin honest: a
          // revalued transfer would let a branch pick its own profit by moving
          // stock in at a cost of its choosing.
          costPrice: line.costPrice,
          sellingPrice: line.sellingPrice,
          expiryDate: line.expiryDate,
        },
      });
      destBatchBySource.set(line.sourceBatchId, created.id);
    }
  }

  return destBatchBySource;
}

/**
 * Next reference number for a transfer out of `branchCode`, e.g. TRF-MAIN-0007.
 * Sequential per branch so dockets sort, and branch-coded so two shops can both
 * have a "0001" without colliding.
 */
export function formatTransferReference(branchCode: string, sequence: number): string {
  return `TRF-${branchCode}-${String(sequence).padStart(4, '0')}`;
}
