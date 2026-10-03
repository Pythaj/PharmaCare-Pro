import { db } from '@/lib/db';
import { toNumber } from '@/lib/utils';
import type { Prisma } from '@prisma/client';
import {
  aggregateRefunds,
  summarizeRevenue,
  ZERO_REFUNDS,
  zeroRevenueSummary,
  type ProductRefundTotals,
  type RefundForAggregation,
  type RefundMoney,
  type RefundTotals,
  type RevenueSummary,
} from '@/lib/refund-shared';

/**
 * The pure half is re-exported so server routes keep importing one module, and so
 * there is a single definition of these rules regardless of which side of the
 * client/server split a caller sits on. A CLIENT component must import from
 * `@/lib/refund-shared` directly — coming through here would pull in Prisma.
 */
export {
  aggregateRefunds,
  ZERO_REFUNDS,
  zeroRevenueSummary,
  summarizeRevenue,
  type ProductRefundTotals,
  type RefundForAggregation,
  type RefundMoney,
  type RefundTotals,
  type RevenueSummary,
};

/**
 * Refund DATA ACCESS — reads approved refunds out of the database.
 *
 * WHY THIS IS SPLIT FROM `refund-shared.ts`
 *
 * The arithmetic that turns refunds into a day's net figure is pure and lives in
 * `refund-shared.ts`, which a `'use client'` component may import. The queries
 * below need `@/lib/db` and are server-only, so they live here. Keeping the two
 * apart is the only way a browser component can read `ZERO_REFUNDS` without
 * pulling Prisma into the bundle — a mistake `tsc` cannot report.
 *
 * Every pure export is re-exported below, so server routes import this one module
 * and the split stays invisible to them.
 */

/**
 * WHY REFUNDS ARE A SEPARATE CONCERN FROM SALES
 *
 * A sale records what was TAKEN. A refund records what was GIVEN BACK. The
 * system was built for the first and then patched for the second, which left
 * three separate defects of the same shape:
 *
 *  - the register compared counted cash against cash taken in, never subtracting
 *    cash handed out, so a day with one refund showed a false shortfall;
 *  - the dashboard's "revenue" was gross, so a branch whose returns were
 *    climbing looked like it was trading better than it was;
 *  - `Sale.profit` is never reversed by a return, so profit overstated the
 *    margin on anything that came back.
 *
 * The fix is not three patches. It is one definition of revenue used by every
 * screen, built so the register, the dashboard and the reports cannot drift
 * apart again — which is exactly how the original problem arose.
 *
 * WHY PROFIT CAN BE REVERSED EXACTLY. `ReturnItem` points at the `SaleItem` it
 * refunds, and that line carries `unitPrice` and `costPrice`. `POST /api/sales`
 * books profit as `(unitPrice - costPrice) * quantity`, so the margin given back
 * is computable to the penny from the same two columns — no estimate, and no
 * schema change.
 */

/** A window over `Return.createdAt`. Any part may be omitted. */
export interface RefundRange {
  gte?: Date;
  lte?: Date;
  lt?: Date;
}

/**
 * Whose refunds to count. A return has no branch of its own, so `branchId` is
 * applied to the SALE it refunds. `userId` is likewise the SELLER, not the
 * operator who processed the refund — "my till" must mean my sales, on the same
 * terms as every sales figure it sits beside.
 */
export interface RefundScope {
  branchId?: string | null;
  /**
   * Seller to scope to. `undefined` filters nothing; `null` filters to sales
   * with no user at all (the "Unknown salesperson" case, used when the User row
   * was deleted). Those two must stay distinct, which is why the filter checks
   * `!== undefined` rather than truthiness.
   */
  userId?: string | null;
}

/**
 * Builds the `sale` relation filter shared by the two refund readers, so the
 * aggregate path and the line path cannot drift apart.
 */
function saleScopeFilter(scope: RefundScope): Prisma.ReturnWhereInput['sale'] | undefined {
  const sale: Prisma.SaleWhereInput = {};
  if (scope.branchId) sale.branchId = scope.branchId;
  if (scope.userId !== undefined) sale.userId = scope.userId;
  return Object.keys(sale).length > 0 ? sale : undefined;
}

/**
 * Reads a window's approved refunds for one branch (or the whole business when
 * `branchId` is null) and totals them for the register's reconciliation.
 *
 * Kept separate from `buildDailyAggregates` because it is NOT part of the
 * persisted register: those columns are the day's statement of record and mean
 * "cash taken", which stays true. The refund term is attached to the register's
 * API payload so the reconciliation can use it without rewriting a closed day's
 * stored totals — and so no migration is needed to correct what the UI compares
 * the counted cash against.
 */
export async function fetchRefundTotals(
  dayStart: Date,
  dayEnd: Date,
  branchId: string | null | undefined,
  tx?: Prisma.TransactionClient
): Promise<RefundTotals> {
  const client = tx ?? db;

  const refunds = await client.return.findMany({
    where: {
      createdAt: { gte: dayStart, lt: dayEnd },
      status: 'approved',
      ...(branchId ? { sale: { branchId } } : {}),
    },
    select: {
      totalRefund: true,
      sale: { select: { paymentMethod: true } },
    },
  });

  return aggregateRefunds(
    refunds.map((refund) => ({
      totalRefund: refund.totalRefund,
      paymentMethod: refund.sale.paymentMethod,
    }))
  );
}

// ---------------------------------------------------------------------------
// Reporting: gross, refunds, net
// ---------------------------------------------------------------------------

/** One approved refund line, flattened for reporting. */
export interface RefundLine {
  totalRefund: number;
  /** The original sale's tender, so the money can be bucketed the same way. */
  paymentMethod: string;
  /**
   * The SELLER of the refunded sale, not the operator who processed the refund.
   * A cashier report that credits one person's till for another's return is the
   * wrong way round.
   */
  sellerId: string | null;
  /**
   * The branch of the refunded sale. A return inherits its branch from the sale,
   * so this is a lookup of where the money went back, not a claim of its own.
   */
  branchId: string;
  createdAt: Date;
  /** The receipt this refund reverses, for invoice-level reconciliation. */
  saleId: string;
  /** Margin given back, derived from the refunded sale lines. */
  refundedProfit: number;
  items: RefundItemLine[];
}

/** One product's share of a refund. */
export interface RefundItemLine {
  productId: string;
  /** The exact receipt line refunded, so a cashier can reconcile a single item. */
  saleItemId: string;
  quantity: number;
  /** The customer's money back for this line — not the catalogue price. */
  refundAmount: number;
}

/**
 * Sums a window's approved refunds without transferring a single row.
 *
 * For headline figures — the dashboard tiles and the report summary — this is the
 * right call: `_sum` and `_count` stay in SQL regardless of whether the window is
 * a day or the whole business. Use `fetchRefundLines` only when the LINES are
 * genuinely needed (profit reversal, per-product attribution).
 */
export async function aggregateRefundMoney(
  range: RefundRange | undefined,
  scope: RefundScope = {},
  tx?: Prisma.TransactionClient
): Promise<RefundMoney> {
  const client = tx ?? db;
  const saleScope = saleScopeFilter(scope);

  const result = await client.return.aggregate({
    where: {
      status: 'approved',
      ...(range && Object.keys(range).length > 0 ? { createdAt: range } : {}),
      ...(saleScope ? { sale: saleScope } : {}),
    },
    _sum: { totalRefund: true },
    _count: { _all: true },
  });

  return {
    totalRefunds: round2(toNumber(result._sum.totalRefund)),
    refundCount: result._count._all,
  };
}

/**
 * Reads a window's approved refunds with enough detail to also reverse profit
 * and attribute money to products.
 *
 * One query serves every report: the register needs only the totals, but the
 * item and profit reports need the lines, and splitting them would mean the same
 * refund being counted two ways.
 */
export async function fetchRefundLines(
  range: RefundRange | undefined,
  scope: RefundScope = {},
  tx?: Prisma.TransactionClient
): Promise<RefundLine[]> {
  const client = tx ?? db;
  const saleScope = saleScopeFilter(scope);

  const rows = await client.return.findMany({
    where: {
      status: 'approved',
      ...(range && Object.keys(range).length > 0 ? { createdAt: range } : {}),
      ...(saleScope ? { sale: saleScope } : {}),
    },
    select: {
      id: true,
      totalRefund: true,
      createdAt: true,
      saleId: true,
      sale: {
        select: {
          paymentMethod: true,
          userId: true,
          branchId: true,
          items: {
            select: {
              id: true,
              productId: true,
              quantity: true,
              unitPrice: true,
              costPrice: true,
              returnItems: {
                // Only approved refunds move money, so a pending return's lines
                // must not reverse profit that has not actually been given up.
                where: { return: { status: 'approved' } },
                // `returnId` is selected so the loop below can keep each Return's
                // lines its own. This nested filter alone is NOT enough: it is
                // evaluated against the whole sale, so a receipt refunded twice
                // would hand both returns' items to each of the two Return rows
                // and reverse the profit twice over. Prisma cannot correlate a
                // nested relation filter to the row that selected it, so the
                // ownership check has to happen here.
                select: { returnId: true, quantity: true, refundAmount: true },
              },
            },
          },
        },
      },
    },
  });

  return rows.map((row) => {
    const items: RefundItemLine[] = [];
    let refundedProfit = 0;

    for (const saleItem of row.sale.items) {
      for (const returned of saleItem.returnItems) {
        // Keep only this return's lines. Without this, two approved returns on
        // one receipt each report the full set of returned items, and the day
        // nets out to more money coming back than ever left the till.
        if (returned.returnId !== row.id) continue;

        const quantity = toNumber(returned.quantity);
        items.push({
          productId: saleItem.productId,
          saleItemId: saleItem.id,
          quantity,
          refundAmount: toNumber(returned.refundAmount),
        });
        // Identical to how the sale booked its margin, so the reversal is exact.
        refundedProfit +=
          (toNumber(saleItem.unitPrice) - toNumber(saleItem.costPrice)) * quantity;
      }
    }

    return {
      totalRefund: toNumber(row.totalRefund),
      paymentMethod: row.sale.paymentMethod,
      sellerId: row.sale.userId,
      branchId: row.sale.branchId,
      createdAt: row.createdAt,
      saleId: row.saleId,
      refundedProfit,
      items,
    };
  });
}

/**
 * Folds refund lines into `quantity` and `refundAmount` per product.
 *
 * "Which product earns most" has to be answered AFTER returns: a drug that sells
 * 500 units and comes back 400 times is not the shop's best seller, it is the
 * shop's most expensive mistake.
 */
export function aggregateRefundsByProduct(
  refunds: readonly RefundLine[]
): Map<string, ProductRefundTotals> {
  const byProduct = new Map<string, ProductRefundTotals>();

  for (const refund of refunds) {
    for (const item of refund.items) {
      const current = byProduct.get(item.productId) ?? { quantity: 0, refundAmount: 0 };
      current.quantity += item.quantity;
      current.refundAmount += item.refundAmount;
      byProduct.set(item.productId, current);
    }
  }

  return byProduct;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}