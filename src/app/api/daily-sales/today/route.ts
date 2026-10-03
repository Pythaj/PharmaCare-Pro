import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { aggregateSales, findOrCreateDailyRecord } from '@/lib/daily-sales'
import { aggregateRefunds, fetchRefundTotals } from '@/lib/refunds'
import { endOfLocalDay, localDateKey, startOfLocalDay } from '@/lib/dates'
import { toNumber } from '@/lib/utils'

/** A sale with its money columns flattened, the batch identified, and the
 *  returned quantity resolved per line. */
function flattenSale(s: any) {
  return {
    ...s,
    subtotal: toNumber(s.subtotal),
    totalAmount: toNumber(s.totalAmount),
    profit: toNumber(s.profit),
    items: (s.items ?? []).map((item: any) => {
      const quantity = Number(item.quantity);
      const returnedQuantity = (item.returnItems ?? []).reduce(
        (sum: number, r: any) => sum + Number(r.quantity ?? 0),
        0
      );
      return {
        ...item,
        quantity,
        unitPrice: toNumber(item.unitPrice),
        costPrice: toNumber(item.costPrice),
        total: toNumber(item.total),
        returnedQuantity,
        returnableQuantity: Math.max(0, quantity - returnedQuantity),
      };
    }),
  };
}

/** A register with its money columns flattened. */
function flattenRecord(r: any) {
  if (!r) return null
  return {
    ...r,
    totalRevenue: toNumber(r.totalRevenue),
    totalProfit: toNumber(r.totalProfit),
    cashTotal: toNumber(r.cashTotal),
    cardTotal: toNumber(r.cardTotal),
    mobileMoneyTotal: toNumber(r.mobileMoneyTotal),
  }
}

const recordInclude = {
  branch: { select: { id: true, name: true, code: true } },
  opener: { select: { id: true, name: true } },
  closer: { select: { id: true, name: true } },
} as const

// GET /api/daily-sales/today — today's register with live sales, per branch.
//
// WHY THIS USED TO REFUSE THE CONSOLIDATED VIEW
//
// A till belongs to one shop, so this originally 400'd whenever the admin was on
// "All branches" and the client swallowed the message — the owner was shown
// "No sales record found for today" for a day that had plenty of sales. The
// refusal was correct (one register per branch per day) but the response was
// wrong: the owner is precisely the person who wants every shop at once.
//
// So the consolidated view is now supported, as one entry per active branch.
// It is READ-ONLY. A single-branch request still auto-creates and refreshes that
// branch's register, because that is the till's own record, but the consolidated
// view never creates or rewrites a register for a shop nobody has opened —
// otherwise merely looking at the dashboard would stamp a new open day onto
// every branch in the business.
export async function GET(request: NextRequest) {
  // Authenticated staff only; identity for opener comes from the JWT cookie
  const auth = await requireBranchScope(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const viewer = auth.user!
    const branchId = auth.scope!.branchId

    // "Today" in LOCAL terms. The register belongs to the shop's trading day,
    // not to UTC: a till that opens at 22:00 local must roll over at local
    // midnight, and a UTC boundary would close its day eight hours early.
    const now = new Date()
    const todayStr = localDateKey(now)

    const dayStart = startOfLocalDay(now)
    // Exclusive upper bound at next midnight — includes the full final second
    // of the day that T23:59:59 dropped
    const dayEnd = endOfLocalDay(now)
    const dayRange = { gte: dayStart, lt: dayEnd }

    // A salesperson sees their OWN sales, not their colleagues'. Forced from the
    // session rather than the query string, and matching GET /api/sales, so the
    // register and the sales list can never disagree about who may see what.
    // The client used to send ?userId= and this route ignored it entirely.
    const requestedUserId = request.nextUrl.searchParams.get('userId') || undefined
    const userFilter = viewer.role === 'admin' ? requestedUserId : viewer.userId

    const saleInclude = {
      user: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, phone: true } },
      // Without this the register's Batch column rendered "-" forever: the UI
      // asked for a batch number that two of the three sales endpoints never sent.
      branch: { select: { id: true, name: true, code: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, unit: true } },
          batch: { select: { id: true, batchNumber: true } },
          // Refund state per line. The Today tab is the register's primary view,
          // so omitting this here left it showing partly-returned receipts as
          // though nothing had come back — even though the day's own drilldown
          // and /api/sales both reported it.
          returnItems: {
            where: { return: { status: { in: ['approved', 'pending'] } } },
            select: { quantity: true },
          },
        },
      },
    }

    if (branchId) {
      // ── Single branch: find-or-create-and-refresh, race-safe ───────────────
      //
      // `findOrCreateDailyRecord` owns the create/recompute step, including the
      // race: this route used to read then create, so a second browser tab (or a
      // sale arriving at the same moment) opened the same day's register twice
      // and the loser returned a 500 for what is a completely normal action.
      await findOrCreateDailyRecord(todayStr, branchId, viewer.userId, { refreshClosedDays: false })

      const record: any = await db.dailySalesRecord.findFirst({
        where: { date: todayStr, branchId },
        include: recordInclude,
      })

      const todaySales = await db.sale.findMany({
        where: {
          createdAt: dayRange,
          branchId,
          ...(userFilter ? { userId: userFilter } : {}),
        },
        include: saleInclude,
        orderBy: { createdAt: 'desc' },
      })

      // Refunds are fetched for the whole day, NOT narrowed by `userFilter`.
      // A cashier can only see their own SALES, but the drawer they are counting
      // is shared: a refund a colleague processed took cash out of the same till
      // and has to be netted off their expected cash too. Hiding it would make
      // the reconciliation fail for a till that is in fact correct.
      const refunds = await fetchRefundTotals(dayStart, dayEnd, branchId)

      return NextResponse.json({
        scope: 'branch',
        date: todayStr,
        branches: [
          {
            branch: record?.branch ?? { id: branchId, name: 'This branch', code: '' },
            record: flattenRecord(record),
            sales: todaySales.map(flattenSale),
            refunds,
          },
        ],
      })
    }

    // ── Consolidated owner view: every active branch, read-only ─────────────
    const activeBranches = await db.branch.findMany({
      where: { active: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    })

    // Two queries for the whole business, not one pair per branch. An admin
    // opening the register used to cost a round trip per shop; with a dozen
    // branches that is a visible stall.
    const [records, sales, refundRows] = await Promise.all([
      db.dailySalesRecord.findMany({ where: { date: todayStr }, include: recordInclude }),
      db.sale.findMany({
        where: {
          createdAt: dayRange,
          branchId: { in: activeBranches.map((b) => b.id) },
          ...(userFilter ? { userId: userFilter } : {}),
        },
        include: saleInclude,
        orderBy: { createdAt: 'desc' },
      }),
      // One query for the whole business, then bucketed in memory. Same totals the
      // single-branch path produces, still narrowed by tender so each branch's
      // card can net its own cash off.
      db.return.findMany({
        where: {
          createdAt: dayRange,
          status: 'approved',
          sale: { branchId: { in: activeBranches.map((b) => b.id) } },
        },
        select: {
          totalRefund: true,
          sale: { select: { paymentMethod: true, branchId: true } },
        },
      }),
    ])

    const recordsByBranch = new Map(records.map((r) => [r.branchId, r]))
    const salesByBranch = new Map<string, any[]>()
    for (const sale of sales) {
      const list = salesByBranch.get(sale.branchId)
      if (list) list.push(sale)
      else salesByBranch.set(sale.branchId, [sale])
    }

    const refundsByBranch = new Map<string, { totalRefund: unknown; paymentMethod: string }[]>()
    for (const row of refundRows) {
      const list = refundsByBranch.get(row.sale.branchId)
      const entry = { totalRefund: row.totalRefund, paymentMethod: row.sale.paymentMethod }
      if (list) list.push(entry)
      else refundsByBranch.set(row.sale.branchId, [entry])
    }

    return NextResponse.json({
      scope: 'all',
      date: todayStr,
      branches: activeBranches.map((branch) => {
        const record = recordsByBranch.get(branch.id)
        const branchSales = salesByBranch.get(branch.id) ?? []
        return {
          branch,
          record: flattenRecord(record),
          sales: branchSales.map(flattenSale),
          refunds: aggregateRefunds(refundsByBranch.get(branch.id) ?? []),
          // A branch that traded today but has no register row yet still has to
          // show its takings, otherwise the owner sees an empty card next to a
          // branch that is visibly busy in the POS. Derived from the same sales
          // rows above, and clearly marked as not yet a register.
          liveTotals: record ? null : aggregateSales(branchSales),
        }
      }),
    })
  } catch (error) {
    console.error('Daily sales today error:', error)
    return NextResponse.json({ error: 'Failed to fetch today\'s sales record' }, { status: 500 })
  }
}
