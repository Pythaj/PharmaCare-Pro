/**
 * Return/refund domain rules — single source of truth for the money side of
 * returns (Rule 18). Shared by POST /api/returns and DELETE /api/returns/[id]
 * so a refund can never be priced one way and the sale's status judged another.
 *
 * A sale is priced as:  totalAmount = subtotal - discount + tax
 * (see POST /api/sales). A refund must give back what the customer actually
 * paid for the returned units, so every line is refunded its *pro-rata share of
 * the net total* — not the raw shelf price. Refunding shelf price would
 * over-refund any discounted sale and under-refund any taxed one, and the sale
 * status check (refunded >= totalAmount) would then never line up.
 */

/** Currency is handled to 2 decimals, so comparisons need half-a-cent slack. */
export const CURRENCY_EPSILON = 0.01;

/** The only statuses a return may ever hold. Mirrors the DB column default. */
export const RETURN_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

/** A pending return is a request; only an approved one moves stock or money. */
export function isReturnStatus(value: unknown): value is ReturnStatus {
  return typeof value === 'string' && (RETURN_STATUSES as readonly string[]).includes(value);
}

export interface SalePricing {
  /** Sum of every line's shelf price (unitPrice x quantity). */
  subtotal: number;
  /** Flat discount taken off the whole sale. */
  discount: number;
  /** Flat tax added to the whole sale. */
  tax: number;
  /** What the customer actually paid: subtotal - discount + tax. */
  totalAmount: number;
}

/**
 * Price of one line as a share of the sale's net total.
 * Falls back to shelf price when the sale has no subtotal to prorate against
 * (a fully discounted / zero-value sale), which keeps the maths finite.
 */
export function netRefundFactor(sale: SalePricing): number {
  if (!(sale.subtotal > 0)) return 1;
  return sale.totalAmount / sale.subtotal;
}

export interface RefundLineInput {
  saleItemId: string;
  quantity: number;
  unitPrice: number;
  batchId: string | null;
}

export interface RefundLine extends RefundLineInput {
  /** Shelf price of the returned units, before discount/tax. */
  grossAmount: number;
  /** What the customer actually gets back for this line. */
  refundAmount: number;
}

/**
 * Splits a return across its lines pro-rata by value and rounds to 2 decimals.
 * The parts always sum to the net value of *these lines* exactly — no stray
 * cent is invented or lost.
 *
 * The target is deliberately the value of the lines being returned, NOT the
 * sale's whole total. Pricing a partial return against the full sale made a
 * one-unit return on a GHS 200 sale refund GHS 200: the largest line was handed
 * the entire remainder. For a complete return the two targets coincide anyway
 * (Σ gross = subtotal, so round2(subtotal x factor) = round2(totalAmount)), so
 * this is strictly more correct and not merely a different rounding.
 */
export function allocateRefunds(lines: RefundLineInput[], sale: SalePricing): RefundLine[] {
  const factor = netRefundFactor(sale);
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const allocated = lines.map((line) => {
    const grossAmount = line.unitPrice * line.quantity;
    return { ...line, grossAmount, refundAmount: round2(grossAmount * factor) };
  });

  if (allocated.length === 0) return allocated;

  // Absorb the sub-cent rounding remainder on the largest line so the refunds
  // add up to the exact net value of the returned units.
  const grossTotal = allocated.reduce((sum, l) => sum + l.grossAmount, 0);
  const target = round2(grossTotal * factor);
  const current = allocated.reduce((sum, l) => sum + l.refundAmount, 0);
  const drift = round2(target - current);
  if (Math.abs(drift) >= 0.005) {
    let largest = 0;
    for (let i = 1; i < allocated.length; i++) {
      if (allocated[i].grossAmount > allocated[largest].grossAmount) largest = i;
    }
    allocated[largest] = {
      ...allocated[largest],
      refundAmount: round2(allocated[largest].refundAmount + drift),
    };
  }

  return allocated;
}

export function sumRefunds(lines: Pick<RefundLine, 'refundAmount'>[]): number {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return round2(lines.reduce((sum, l) => sum + l.refundAmount, 0));
}

/** Sale status vocabulary — mirrors the Sale.status column comment. */
export const SALE_STATUSES = ['completed', 'partial_return', 'returned'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

/**
 * Single rule for a sale's status from its approved refunds — used when a
 * return is created and when a pending one is deleted, so a sale can never end
 * up labelled one way by a create and another way by a delete.
 *
 * @param totalRefunded Sum of APPROVED refunds only (pending/rejected refunds
 *                      neither move money nor change the status).
 * @param previousStatus Status to fall back to when nothing has been refunded
 *                       yet, so an unrelated prior state is never clobbered.
 */
export function saleStatusForRefunds(
  totalRefunded: number,
  saleTotal: number,
  previousStatus: string = 'completed'
): SaleStatus {
  if (totalRefunded <= 0) {
    return isSaleStatus(previousStatus) ? previousStatus : 'completed';
  }
  return totalRefunded >= saleTotal - CURRENCY_EPSILON ? 'returned' : 'partial_return';
}

export function isSaleStatus(value: unknown): value is SaleStatus {
  return typeof value === 'string' && (SALE_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Transactional side effects
//
// Typed structurally (not with Prisma's generated types) so this module stays
// importable from a client component: the client uses the pure maths above to
// preview a refund, the API uses the same maths to price it, and the two can
// never disagree.
// ---------------------------------------------------------------------------

interface BatchUpdater {
  batch: {
    update(args: {
      where: { id: string };
      data: { quantity: { increment: number } };
    }): Promise<unknown>;
  };
}

export interface StockLine {
  batchId: string | null;
  quantity: number;
}

/**
 * Moves stock for a return. `direction` is +1 to put returned units back into
 * their original batch (an approved return) and -1 to take them out again (a
 * return being voided). Lines without a batch (items sold without one) are
 * skipped — there is nothing to adjust.
 */
export async function applyReturnStock(
  tx: BatchUpdater,
  lines: StockLine[],
  direction: 1 | -1
): Promise<void> {
  for (const line of lines) {
    if (!line.batchId || line.quantity <= 0) continue;
    await tx.batch.update({
      where: { id: line.batchId },
      data: { quantity: { increment: direction * line.quantity } },
    });
  }
}

interface StatusRecalculator extends BatchUpdater {
  return: {
    aggregate(args: {
      where: { saleId: string; status: string };
      _sum: { totalRefund: true };
    }): Promise<{ _sum: { totalRefund: number | null } }>;
  };
  sale: {
    update(args: {
      where: { id: string };
      data: { status: string };
    }): Promise<unknown>;
  };
}

/**
 * Recomputes a sale's status from its APPROVED refunds and writes it back.
 * Called after every return state change (create, approve, delete) so the sale
 * can never be labelled one way by a create and another by a delete.
 */
export async function recomputeSaleStatus(
  tx: StatusRecalculator,
  saleId: string,
  saleTotal: number,
  previousStatus: string
): Promise<SaleStatus> {
  const approved = await tx.return.aggregate({
    where: { saleId, status: 'approved' },
    _sum: { totalRefund: true },
  });

  const status = saleStatusForRefunds(
    approved._sum.totalRefund ?? 0,
    saleTotal,
    previousStatus
  );

  await tx.sale.update({ where: { id: saleId }, data: { status } });
  return status;
}

