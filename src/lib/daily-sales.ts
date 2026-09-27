import { db } from '@/lib/db';
import { toNumber } from '@/lib/utils';
import type { Prisma } from '@prisma/client';

/** Shape of the aggregated daily-register metrics, derived purely from sales. */
export interface DailyAggregates {
  totalRevenue: number;
  totalProfit: number;
  totalDiscount: number;
  totalTransactions: number;
  totalItemsSold: number;
  cashTotal: number;
  cardTotal: number;
  mobileMoneyTotal: number;
}

/**
 * Computes daily register aggregates from actual sales records for a given
 * day [dayStart, dayEnd). Single source of truth for the cash-register totals.
 *
 * `branchId` scopes the totals to one branch. `null` means every branch, which
 * is the consolidated owner view — correct there, but note a per-branch till
 * must always pass its own id, otherwise Branch A's register would report
 * Branch B's takings and the day would never balance.
 */
async function buildDailyAggregates(
  dayStart: Date,
  dayEnd: Date,
  tx?: Prisma.TransactionClient,
  branchId?: string | null
): Promise<DailyAggregates> {
  const client = tx ?? db;
  const sales = await client.sale.findMany({
    where: {
      createdAt: { gte: dayStart, lt: dayEnd },
      ...(branchId ? { branchId } : {}),
    },
    include: { items: true },
  });

  // Money columns are Decimal; flatten to numbers once so the totals below are
  // plain arithmetic (and serialise as numbers, not Decimal strings).
  const totals = sales.map((s) => ({
    totalAmount: toNumber(s.totalAmount),
    profit: toNumber(s.profit),
    discount: toNumber(s.discount),
    paymentMethod: s.paymentMethod,
  }));

  return {
    totalRevenue: totals.reduce((sum, s) => sum + s.totalAmount, 0),
    totalProfit: totals.reduce((sum, s) => sum + s.profit, 0),
    totalDiscount: totals.reduce((sum, s) => sum + s.discount, 0),
    totalTransactions: totals.length,
    totalItemsSold: sales.reduce(
      (sum, s) => sum + (s.items?.reduce((is, i) => is + i.quantity, 0) || 0),
      0,
    ),
    cashTotal: totals.filter((s) => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.totalAmount, 0),
    cardTotal: totals.filter((s) => s.paymentMethod === 'card').reduce((sum, s) => sum + s.totalAmount, 0),
    mobileMoneyTotal: totals.filter((s) => s.paymentMethod === 'mobile_money').reduce((sum, s) => sum + s.totalAmount, 0),
  };
}

/**
 * Recomputes the DailySalesRecord aggregates for a given date (YYYY-MM-DD)
 * from the actual sales in the database.
 *
 * Used after any operation that removes or alters a day's sales outside the
 * normal POS flow (e.g. admin sale deletion) so register totals can never
 * silently drift from reality. Works for both open and closed days —
 * closure metadata (closedBy/closedAt/notes) is preserved.
 *
 * `branchId` is REQUIRED, not optional. There is one register per branch per
 * day, so a recompute without a branch would update whichever record the
 * database returns first and write one shop's day into another shop's till.
 * Making it a required argument turns that from a silent accounting error into
 * a compile error.
 */
export async function recomputeDailyRecord(
  date: string,
  tx: Prisma.TransactionClient | undefined,
  branchId: string
): Promise<void> {
  const client = tx ?? db;

  const record = await client.dailySalesRecord.findFirst({
    where: { date, branchId },
  });
  if (!record) return; // no register was opened for that day

  const dayStart = new Date(date + 'T00:00:00');
  const dayEnd = new Date(date + 'T00:00:00');
  dayEnd.setDate(dayEnd.getDate() + 1);

  // Always recompute from the record's OWN branch, not the caller's argument:
  // a consolidated recompute must never overwrite one branch's till with the
  // whole business's numbers.
  const aggregates = await buildDailyAggregates(dayStart, dayEnd, tx, record.branchId);

  await client.dailySalesRecord.update({
    where: { id: record.id },
    data: {
      totalRevenue: aggregates.totalRevenue,
      totalProfit: aggregates.totalProfit,
      totalDiscount: aggregates.totalDiscount,
      totalTransactions: aggregates.totalTransactions,
      totalItemsSold: aggregates.totalItemsSold,
      cashTotal: aggregates.cashTotal,
      cardTotal: aggregates.cardTotal,
      mobileMoneyTotal: aggregates.mobileMoneyTotal,
    },
  });
}

/**
 * Ensures a daily register exists for a date, then recomputes its totals from
 * the actual sales. Used when a sale is recorded against a past date that has
 * no register yet (or one whose totals must reflect the new sale).
 *
 * - Missing record  -> created as an OPEN day (seeded with the opener)
 * - Existing record -> left untouched on open/closed status (closure metadata
 *   is never falsified); only totals are recomputed.
 *
 * `branchId` identifies WHICH register, and is required: a daily record is NOT
 * NULL on branchId, so there is no such thing as a branchless till. Without it
 * this would find the first record for the date and mix two branches' money
 * into one register.
 */
export async function ensureDailyRecord(
  date: string,
  openedBy: string | null | undefined,
  branchId: string
): Promise<void> {
  const existing = await db.dailySalesRecord.findFirst({
    where: { date, branchId },
  });
  if (!existing) {
    const dayStart = new Date(date + 'T00:00:00');
    const dayEnd = new Date(date + 'T00:00:00');
    dayEnd.setDate(dayEnd.getDate() + 1);
    const aggregates = await buildDailyAggregates(dayStart, dayEnd, undefined, branchId);

    await db.dailySalesRecord.create({
      data: {
        date,
        branchId,
        status: 'open',
        openedBy: openedBy ?? null,
        ...aggregates,
      },
    });
  }

  await recomputeDailyRecord(date, undefined, branchId);
}

export { buildDailyAggregates };
