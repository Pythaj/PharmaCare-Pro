import { db } from '@/lib/db';
import { toNumber } from '@/lib/utils';
import { localDayRange } from '@/lib/dates';
import { isUniqueConstraintViolation } from '@/lib/prisma-errors';
import type { Prisma } from '@prisma/client';

/** Shape of the aggregated daily-register metrics, derived purely from sales. */
export interface DailyAggregates {
  totalRevenue: number;
  totalProfit: number;
  totalTransactions: number;
  totalItemsSold: number;
  cashTotal: number;
  cardTotal: number;
  mobileMoneyTotal: number;
}

/** An aggregate written into a brand-new register, before any recompute. */
export const ZERO_AGGREGATES: DailyAggregates = {
  totalRevenue: 0,
  totalProfit: 0,
  totalTransactions: 0,
  totalItemsSold: 0,
  cashTotal: 0,
  cardTotal: 0,
  mobileMoneyTotal: 0,
};

/**
 * The minimum a sale row must expose to be totalled. Structural so the same
 * function serves a full Prisma query, a hand-rolled include, and a test.
 */
export interface SaleForAggregation {
  totalAmount: unknown;
  profit: unknown;
  paymentMethod: string;
  items?: readonly { quantity: unknown }[] | null;
}

/**
 * Reduces a day's sales to register totals — the single source of truth for the
 * money side of a trading day.
 *
 * This used to be written out three times: as a Prisma query in
 * `buildDailyAggregates`, inline in `POST /api/daily-sales`, and again in the
 * consolidated branch cards of `GET /api/daily-sales/today`. The three agreed
 * today. When one of them gained a term they would not have, and the register
 * would show a different figure from the branch card for the very same day.
 *
 * Money columns are Decimal, so they are flattened to numbers here — once, at
 * the edge — and everything below is plain arithmetic that also serialises as a
 * number rather than a string.
 */
export function aggregateSales(sales: readonly SaleForAggregation[]): DailyAggregates {
  const totals = sales.map((sale) => ({
    totalAmount: toNumber(sale.totalAmount),
    profit: toNumber(sale.profit),
    paymentMethod: sale.paymentMethod,
  }));

  const byPayment = (method: string) =>
    totals.filter((sale) => sale.paymentMethod === method)
      .reduce((sum, sale) => sum + sale.totalAmount, 0);

  return {
    totalRevenue: totals.reduce((sum, sale) => sum + sale.totalAmount, 0),
    totalProfit: totals.reduce((sum, sale) => sum + sale.profit, 0),
    totalTransactions: totals.length,
    totalItemsSold: sales.reduce(
      (sum, sale) => sum + (sale.items ?? []).reduce((items, item) => items + toNumber(item.quantity), 0),
      0,
    ),
    cashTotal: byPayment('cash'),
    cardTotal: byPayment('card'),
    mobileMoneyTotal: byPayment('mobile_money'),
  };
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

  return aggregateSales(sales);
}

/**
 * Whether two aggregate sets agree on every field.
 *
 * Compared field by field rather than by JSON.stringify: these are plain numbers
 * and a serialisation compare would also make the check depend on key order and
 * on how `undefined` happens to render, which is a trap in a function whose only
 * job is to decide whether to retry.
 */
function aggregatesMatch(a: DailyAggregates, b: DailyAggregates): boolean {
  return (
    a.totalRevenue === b.totalRevenue &&
    a.totalProfit === b.totalProfit &&
    a.totalTransactions === b.totalTransactions &&
    a.totalItemsSold === b.totalItemsSold &&
    a.cashTotal === b.cashTotal &&
    a.cardTotal === b.cardTotal &&
    a.mobileMoneyTotal === b.mobileMoneyTotal
  );
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
 * Making it a required argument turns that from a silent accounting error into a
 * compile error.
 *
 * ## Why this loops (the lost update)
 *
 * Read-aggregate-then-write is three statements with no lock between them, and
 * two concurrent calls interleave:
 *
 *   T1: commit sale A -> aggregate (sees A)
 *   T2: commit sale B -> aggregate (sees A+B) -> write A+B
 *   T1: write A            <-- lands last, so B vanishes from the till
 *
 * The register then permanently under-reports the day, and nothing re-derives it
 * until someone closes the day or edits a sale. Sale B is in the drawer and in
 * the item report but missing from the register that is supposed to reconcile
 * them — precisely the discrepancy this table exists to rule out.
 *
 * The ordering is the problem, not the arithmetic: the last writer can hold the
 * OLDEST snapshot. No ordering of these two calls fixes it, and neither does a
 * unique index.
 *
 * So the write is followed by a fresh read: if the aggregates still match what
 * was written, nothing landed in the gap and the value is current; if they do
 * not, a sale committed while we were writing and the whole thing is redone from
 * the newer snapshot. It converges because every mutation recomputes, so the
 * final writer in a burst of concurrent activity is necessarily working from a
 * snapshot taken after the last commit.
 *
 * Bounded at three attempts. A retry loop that is correct but unbounded is a
 * hang in production, and failing to converge after three passes means sales are
 * landing faster than a register can be written — a condition that gets logged
 * rather than spun on. The next poll or close then recomputes from scratch.
 *
 * Skipped when called with a transaction: inside the caller's transaction this
 * is the only writer for that sale and the aggregate legitimately cannot yet see
 * it, so a convergence check would always report "changed" and burn its retries.
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

  const { start: dayStart, end: dayEnd } = localDayRange(date);

  // Always recompute from the record's OWN branch, not the caller's argument:
  // a consolidated recompute must never overwrite one branch's till with the
  // whole business's numbers.
  //
  // `data: aggregates` writes the aggregate object directly rather than
  // re-listing its seven fields. Every field of DailyAggregates maps 1:1 to a
  // column of the same name and type, and the previous hand-written list was a
  // place for the two to drift — add a column to the aggregate and forget the
  // write, and the register silently stops tracking it with nothing to catch it.
  const attempts = tx ? 1 : 3;
  let written: DailyAggregates | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const aggregates = await buildDailyAggregates(dayStart, dayEnd, tx, record.branchId);

    await client.dailySalesRecord.update({
      where: { id: record.id },
      data: aggregates,
    });

    if (attempts === 1) return;
    written = aggregates;

    // Re-read after the write. This is the only way to learn whether a sale
    // committed in the window between our read and our write, short of locking
    // the row (which Prisma does not expose portably across the SQLite build).
    const after = await buildDailyAggregates(dayStart, dayEnd, tx, record.branchId);
    if (aggregatesMatch(written, after)) return;

    if (attempt === attempts) {
      /* Did not settle. The register may be stale, so say so in the log where an
         operator or an alert can find it — a silently drifting till is the exact
         failure this whole function exists to prevent, and the next recompute
         will repair it. */
      console.warn('Daily register did not converge; last write may be behind the sales table', {
        date,
        branchId: record.branchId,
        recordId: record.id,
        written,
        latest: after,
      });
    }
  }
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
 *
 * RACE-SAFE. This used to be a read (`findFirst`) followed by a `create`, which
 * is a check-then-act: two tills opening the same day at the same branch — or a
 * sale and a register landing together — both saw "no register", both created,
 * and the loser took a P2002. The caller swallowed that, so the day's totals
 * were simply left stale, and the sale was recorded against a register that never
 * learned about it. Here the create is attempted directly and a unique violation
 * is treated as "someone else opened it first"; the recompute that follows reads
 * the actual sales, so the register converges on the truth either way.
 *
 * The new row is seeded with zeros rather than a pre-computed total: the totals
 * are recomputed immediately afterwards from the same sales, so seeding them
 * would cost a second full-day query and could be stale before the next line
 * ran.
 */
export async function ensureDailyRecord(
  date: string,
  openedBy: string | null | undefined,
  branchId: string,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx ?? db;

  try {
    await client.dailySalesRecord.create({
      data: {
        date,
        branchId,
        status: 'open',
        openedBy: openedBy ?? null,
        ...ZERO_AGGREGATES,
      },
    });
  } catch (error) {
    // Someone else opened this register between nothing and now. Their row is
    // the real one; anything other than that collision is a genuine fault and
    // must not be hidden.
    if (!isUniqueConstraintViolation(error)) throw error;
  }

  await recomputeDailyRecord(date, tx, branchId);
}

/**
 * The record for a branch on a date, creating it (open, zeroed) if absent, then
 * bringing its totals up to date from the day's actual sales.
 *
 * Shared by `GET /api/daily-sales/today` and `POST /api/daily-sales`, which both
 * needed this exact behaviour and each had its own copy of the read-then-create
 * race.
 *
 * @param refreshClosedDays Set false for a caller that must not disturb a closed
 *   register: a closed day's totals are a statement of record and must not move
 *   because someone back-dated a sale into it.
 */
export async function findOrCreateDailyRecord(
  date: string,
  branchId: string,
  openedBy: string | null | undefined,
  options: { refreshClosedDays?: boolean } = {}
): Promise<{ record: { id: string; status: string; branchId: string } | null; created: boolean }> {
  const existing = await db.dailySalesRecord.findFirst({
    where: { date, branchId },
    select: { id: true, status: true, branchId: true },
  });

  if (existing) {
    const refreshClosed = options.refreshClosedDays ?? true;
    if (refreshClosed || existing.status === 'open') {
      await recomputeDailyRecord(date, undefined, branchId);
    }
    return { record: existing, created: false };
  }

  try {
    const created = await db.dailySalesRecord.create({
      data: {
        date,
        branchId,
        status: 'open',
        openedBy: openedBy ?? null,
        ...ZERO_AGGREGATES,
      },
      select: { id: true, status: true, branchId: true },
    });
    await recomputeDailyRecord(date, undefined, branchId);
    return { record: created, created: true };
  } catch (error) {
    // Lost the create race. The winner's row is authoritative — refresh from it
    // and report it as pre-existing rather than surfacing a constraint error to a
    // cashier who merely opened the register.
    if (!isUniqueConstraintViolation(error)) throw error;

    const winner = await db.dailySalesRecord.findFirst({
      where: { date, branchId },
      select: { id: true, status: true, branchId: true },
    });
    if (winner) {
      await recomputeDailyRecord(date, undefined, branchId);
      return { record: winner, created: false };
    }
    throw error;
  }
}

export { buildDailyAggregates };