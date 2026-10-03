import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { requireBranchForWrite } from '@/lib/branches'
import { logAudit, getClientIp } from '@/lib/audit'
import { toNumber } from '@/lib/utils'
import { buildDailyAggregates } from '@/lib/daily-sales'
import { fetchRefundTotals } from '@/lib/refunds'
import { localDayRange } from '@/lib/dates'
import { ConflictError, ValidationError, parseErrorResponse } from '@/lib/api-error'

const MAX_NOTES_LENGTH = 500

/**
 * Normalises a free-text field before it reaches a string column.
 *
 * `notes: notes || record.notes` passed anything truthy straight through, so a
 * number or an object from a hand-written request reached Prisma as a `String`
 * field and surfaced as a 500 instead of a 400. `notes` is also the one place a
 * cashier can put free text into the books, so it is length-capped.
 */
function parseNotes(value: unknown, fallback: string | null): string | null {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') {
    throw new ValidationError('Notes must be text');
  }

  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (trimmed.length > MAX_NOTES_LENGTH) {
    throw new ValidationError(`Notes must be ${MAX_NOTES_LENGTH} characters or fewer`);
  }

  return trimmed;
}

/**
 * A register with its money columns flattened to numbers.
 *
 * Money columns are Decimal, so they arrive at the client as JSON strings. The
 * closing-summary maths (`counted − expected`) and the difference thresholds that
 * decide whether a till balances were therefore running on string arithmetic
 * against a `number`-typed field. Flattened once, here, at the edge.
 */
function flattenRecord<T extends {
  totalRevenue: unknown;
  totalProfit: unknown;
  cashTotal: unknown;
  cardTotal: unknown;
  mobileMoneyTotal: unknown;
}>(record: T | null): (Omit<T, 'totalRevenue' | 'totalProfit' | 'cashTotal' | 'cardTotal' | 'mobileMoneyTotal'> & {
  totalRevenue: number;
  totalProfit: number;
  cashTotal: number;
  cardTotal: number;
  mobileMoneyTotal: number;
}) | null {
  if (!record) return null;
  return {
    ...record,
    totalRevenue: toNumber(record.totalRevenue),
    totalProfit: toNumber(record.totalProfit),
    cashTotal: toNumber(record.cashTotal),
    cardTotal: toNumber(record.cardTotal),
    mobileMoneyTotal: toNumber(record.mobileMoneyTotal),
  };
}

/**
 * GET /api/daily-sales/[id] — get a specific day's record with all sales
 *
 * A daily record belongs to exactly one branch, and the day-close recomputation
 * is MONEY. Both used to ignore the branch entirely: the sales list was filtered
 * only by date, and closing a day summed every branch's takings for that date
 * into the record. Two branches trading on the same day would produce a
 * "closed" register whose revenue matched neither of them.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireBranchScope(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params

    const record = await db.dailySalesRecord.findUnique({
      where: { id },
      include: {
        opener: { select: { id: true, name: true } },
        closer: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
    })

    if (!record) {
      return NextResponse.json({ error: 'Daily sales record not found' }, { status: 404 })
    }

    if (auth.scope!.branchId && record.branchId !== auth.scope!.branchId) {
      return NextResponse.json(
        { error: 'That register belongs to a different branch' },
        { status: 403 }
      )
    }

    // Fetch all sales for this date (exclusive next-midnight bound), narrowed to
    // the RECORD's branch — not the caller's, so a consolidated view still
    // returns a single coherent day's book for the branch it asked about.
    const { start: dayStart, end: dayEnd } = localDayRange(record.date)

    const sales = await db.sale.findMany({
      where: { branchId: record.branchId, createdAt: { gte: dayStart, lt: dayEnd } },
      include: {
        user: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true, phone: true } },
        branch: { select: { id: true, name: true, code: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, unit: true } },
            // The register's Batch column rendered "-" for every row because this
            // include never asked for the batch, while the UI, the CSV export and
            // /api/sales/[id] all expected it.
            batch: { select: { id: true, batchNumber: true } },
            // Refund state per line. Without it the register shows a day as if
            // nothing was returned against it, so the day's item counts and
            // revenue do not reconcile with the POS.
            returnItems: {
              where: { return: { status: { in: ['approved', 'pending'] } } },
              select: { quantity: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // What the till actually handed back out that day. Needed here because this
    // endpoint feeds the closed-day view AND the printed closing summary, and both
    // compare counted cash against `cashTotal`. `cashTotal` is cash taken in, so
    // without this term a day with a cash refund reports a shortfall equal to that
    // refund — on a drawer that is in fact correct.
    const refunds = await fetchRefundTotals(dayStart, dayEnd, record.branchId)

    return NextResponse.json({
      record: flattenRecord(record),
      refunds,
      sales: sales.map((s) => ({
        ...s,
        subtotal: toNumber(s.subtotal),
        totalAmount: toNumber(s.totalAmount),
        profit: toNumber(s.profit),
        items: s.items.map((item) => {
          const quantity = Number(item.quantity)
          const returnedQuantity = (item.returnItems ?? []).reduce(
            (sum: number, r: any) => sum + Number(r.quantity ?? 0),
            0
          )
          return {
            ...item,
            quantity,
            unitPrice: toNumber(item.unitPrice),
            costPrice: toNumber(item.costPrice),
            total: toNumber(item.total),
            returnedQuantity,
            // Never negative: a return cannot exceed the sale, but a
            // hand-edited row must not present "5 sold, 7 returned" as 2
            // still returnable to a cashier.
            returnableQuantity: Math.max(0, quantity - returnedQuantity),
          }
        }),
      })),
    })
  } catch (error) {
    console.error('Daily sales detail error:', error)
    return NextResponse.json({ error: 'Failed to fetch daily sales record' }, { status: 500 })
  }
}

// PATCH /api/daily-sales/[id] — close the day's record (staff) or reopen it (admin only)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireBranchScope(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const userId = auth.user!.userId

  try {
    const { id } = await params
    const body = await request.json()
    const { action, notes } = body

    // Closing or reopening a day finalises MONEY for one shop's till, so the
    // branch must be selected. The old `if (scope.branchId && ...)` comparison
    // was skipped entirely on the consolidated "All branches" view, where
    // `scope.branchId` is null — so an admin browsing the whole business could
    // close any branch's day and stamp their own approval over that shop's books.
    const branchId = requireBranchForWrite(
      auth.scope!,
      'Select the branch whose register you are closing first — a day belongs to one till'
    )

    const record = await db.dailySalesRecord.findFirst({ where: { id, branchId } })

    if (!record) {
      return NextResponse.json(
        { error: 'Daily sales record not found at the selected branch' },
        { status: 404 }
      )
    }

    if (action === 'close') {
      if (record.status === 'closed') {
        return NextResponse.json({ error: 'This day is already closed' }, { status: 400 })
      }

      const closingNotes = parseNotes(notes, record.notes)

      // Closing a day finalises MONEY, so the totals and the status flip have to
      // be a single decision.
      //
      // The aggregate read and the write used to be separate statements with an
      // `status === 'open'` check in between — check-then-act, twice over. Two
      // operators closing at the same moment both passed the check and both
      // wrote a "final" total, and a sale committed between the aggregate query
      // and the update was silently excluded from a register that then claimed to
      // be final. Reading the totals inside the transaction and making the write
      // conditional on the day still being open means exactly one close can win,
      // and the loser is told the day is already closed instead of having their
      // figures recorded over the winner's.
      const { start, end } = localDayRange(record.date)
      const closedAt = new Date()

      const updated = await db.$transaction(async (tx) => {
        const totals = await buildDailyAggregates(start, end, tx, record.branchId)

        const claimed = await tx.dailySalesRecord.updateMany({
          where: { id, status: 'open' },
          data: {
            status: 'closed',
            closedBy: userId,
            closedAt,
            ...totals,
            notes: closingNotes,
          },
        })
        if (claimed.count === 0) {
          throw new ConflictError('This day is already closed')
        }

        return tx.dailySalesRecord.findUnique({
          where: { id },
          include: {
            opener: { select: { id: true, name: true } },
            closer: { select: { id: true, name: true } },
          },
        })
      })

      await logAudit({
        userId,
        action: 'CLOSE_DAY',
        entity: 'DailySalesRecord',
        entityId: id,
        details: `Closed register for ${record.date} (GHS ${toNumber(updated?.totalRevenue).toFixed(2)} across ${toNumber(updated?.totalTransactions)} sales)`,
        branchId: record.branchId,
        ipAddress: getClientIp(request),
      })

      // The refund term travels with the close response: the closing summary it
      // triggers reconciles counted cash, and that comparison is only valid net of
      // the cash already handed back out during the day being closed.
      const refunds = await fetchRefundTotals(start, end, record.branchId)

      return NextResponse.json({ ...flattenRecord(updated), refunds })
    }

    if (action === 'reopen') {
      // Reopening a closed register is a privileged action
      if (auth.user!.role !== 'admin') {
        return NextResponse.json({ error: 'Admin access required to reopen a closed day' }, { status: 403 })
      }
      if (record.status === 'open') {
        return NextResponse.json({ error: 'This day is already open' }, { status: 400 })
      }

      // Reopening clears the closure stamp and brings the day's totals back in line
      // with its actual sales in one transaction, so the register is never briefly
      // "open" while still showing the figures frozen at close time. Reusing the
      // shared aggregator keeps a reopened day identical to a day that was never
      // closed.
      const updated = await db.$transaction(async (tx) => {
        await tx.dailySalesRecord.update({
          where: { id },
          data: {
            status: 'open',
            closedBy: null,
            closedAt: null,
          },
          select: { id: true },
        })

        const { start, end } = localDayRange(record.date)
        const totals = await buildDailyAggregates(start, end, tx, record.branchId)

        return tx.dailySalesRecord.update({
          where: { id },
          data: { ...totals },
          include: {
            opener: { select: { id: true, name: true } },
            closer: { select: { id: true, name: true } },
          },
        })
      })

      await logAudit({
        userId,
        action: 'REOPEN_DAY',
        entity: 'DailySalesRecord',
        entityId: id,
        details: `Reopened register for ${record.date}`,
        branchId: record.branchId,
        ipAddress: getClientIp(request),
      })

      const { start, end } = localDayRange(record.date)
      const reopenedRefunds = await fetchRefundTotals(start, end, record.branchId)

      return NextResponse.json({ ...flattenRecord(updated), refunds: reopenedRefunds })
    }

    return NextResponse.json({ error: 'Invalid action. Use "close" or "reopen"' }, { status: 400 })
  } catch (error) {
    console.error('Daily sales update error:', error)
    // A lost close race is a client-correctable outcome, not a server fault: the
    // caller needs to see 409 and refresh, not "Something went wrong".
    const mapped = parseErrorResponse(error, 'Failed to update daily sales record')
    if (mapped) return mapped
    return NextResponse.json({ error: 'Failed to update daily sales record' }, { status: 500 })
  }
}
