import { db } from '@/lib/db';
import type { Prisma } from '@prisma/client';

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

  const sales = await client.sale.findMany({
    where: { createdAt: { gte: dayStart, lt: dayEnd } },
    include: { items: true },
  });

  await client.dailySalesRecord.update({
    where: { id: record.id },
    data: {
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
    },
  });
}
