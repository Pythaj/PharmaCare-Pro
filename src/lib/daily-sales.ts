import { db } from '@/lib/db';
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
 */
async function buildDailyAggregates(
  dayStart: Date,
  dayEnd: Date,
  tx?: Prisma.TransactionClient
): Promise<DailyAggregates> {
  const client = tx ?? db;
  const sales = await client.sale.findMany({
    where: { createdAt: { gte: dayStart, lt: dayEnd } },
    include: { items: true },
  });

  return {
    totalRevenue: sales.reduce((sum, s) => sum + s.totalAmount, 0),
    totalProfit: sales.reduce((sum, s) => sum + s.profit, 0),
    totalDiscount: sales.reduce((sum, s) => sum + s.discount, 0),
    totalTransactions: sales.length,
    totalItemsSold: sales.reduce(
      (sum, s) => sum + (s.items?.reduce((is, i) => is + i.quantity, 0) || 0),
      0,
    ),
    cashTotal: sales.filter((s) => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.totalAmount, 0),
    cardTotal: sales.filter((s) => s.paymentMethod === 'card').reduce((sum, s) => sum + s.totalAmount, 0),
    mobileMoneyTotal: sales.filter((s) => s.paymentMethod === 'mobile_money').reduce((sum, s) => sum + s.totalAmount, 0),
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
 */
export async function recomputeDailyRecord(
  date: string,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx ?? db;

  const record = await client.dailySalesRecord.findUnique({ where: { date } });
  if (!record) return; // no register was opened for that day

  const dayStart = new Date(date + 'T00:00:00');
  const dayEnd = new Date(date + 'T00:00:00');
  dayEnd.setDate(dayEnd.getDate() + 1);

  const aggregates = await buildDailyAggregates(dayStart, dayEnd, tx);

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

export { buildDailyAggregates };
