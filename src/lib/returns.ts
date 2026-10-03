/**
 * Return/refund domain rules — single source of truth for the money side of
 * returns (Rule 18). Shared by POST /api/returns and DELETE /api/returns/[id]
 * so a refund can never be priced one way and the sale's status judged another.
 *
 * A refund must give back what the customer actually paid for the returned
 * units. This app has no discount and no tax, so every sale it writes has
 * `totalAmount === subtotal` and each line is refunded its own shelf price.
 *
 * The proration below still runs against the *recorded* pair rather than
 * assuming they are equal, because sales written before discount and tax were
 * removed can have a charged total below their shelf-price subtotal. Refunding
 * those at shelf price would hand back more cash than was ever collected and
 * the sale's status check (refunded >= totalAmount) would never line up. The
 * factor is 1 for every new sale, so this costs nothing and keeps old receipts
 * refundable to the cent.
 */

import { roundMoney, sumMoney } from '@/lib/money';

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
  /** What the customer was actually charged. Equals `subtotal` for new sales. */
  totalAmount: number;
}

/**
 * Price of one line as a share of the sale's charged total.
 * Always 1 for a sale this app wrote; see the note at the top of this file.
 * Falls back to shelf price when there is no subtotal to prorate against,
 * which keeps the maths finite.
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
  /** Shelf price of the returned units. */
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

  const allocated = lines.map((line) => {
    const grossAmount = line.unitPrice * line.quantity;
    return { ...line, grossAmount, refundAmount: roundMoney(grossAmount * factor) };
  });

  if (allocated.length === 0) return allocated;

  // Absorb the sub-cent rounding remainder on the largest line so the refunds
  // add up to the exact net value of the returned units.
  const grossTotal = allocated.reduce((sum, l) => sum + l.grossAmount, 0);
  const target = roundMoney(grossTotal * factor);
  const current = allocated.reduce((sum, l) => sum + l.refundAmount, 0);
  const drift = roundMoney(target - current);
  if (Math.abs(drift) >= 0.005) {
    let largest = 0;
    for (let i = 1; i < allocated.length; i++) {
      if (allocated[i].grossAmount > allocated[largest].grossAmount) largest = i;
    }
    allocated[largest] = {
      ...allocated[largest],
      refundAmount: roundMoney(allocated[largest].refundAmount + drift),
    };
  }

  return allocated;
}

export function sumRefunds(lines: Pick<RefundLine, 'refundAmount'>[]): number {
  return sumMoney(lines.map((line) => line.refundAmount));
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
//
// The stock movement a return performs is NOT here: it lives in `lib/stock.ts`
// alongside the sale handler's, because both are the same primitive — move units
// on or off a batch, re-asserting the owning branch first.
// ---------------------------------------------------------------------------

interface StatusRecalculator {
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

