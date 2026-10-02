import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { buildDailyAggregates, type DailyAggregates } from '@/lib/daily-sales'
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
    const todayStr = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0')

    const dayStart = new Date(todayStr + 'T00:00:00')
    // Exclusive upper bound at next midnight — includes the full final second
    // of the day that T23:59:59 dropped
    const dayEnd = new Date(todayStr + 'T00:00:00')
    dayEnd.setDate(dayEnd.getDate() + 1)
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
      // ── Single branch: the full find-or-create-and-refresh behaviour ───────
      let record: any = await db.dailySalesRecord.findFirst({
        where: { date: todayStr, branchId },
        include: recordInclude,
      })

      if (!record) {
        // Auto-create if doesn't exist — aggregates derived from existing sales
        const aggregates = await buildDailyAggregates(dayStart, dayEnd, undefined, branchId)

        record = await db.dailySalesRecord.create({
          data: {
            date: todayStr,
            branchId,
            status: 'open',
            openedBy: viewer.userId,
            ...aggregates,
          },
          include: recordInclude,
        })
      } else if (record.status === 'open') {
        // Refresh stats if day is still open (sales might have been added).
        // Only while open: a closed day's totals are a statement of record and
        // must not move because someone back-dated a sale into it.
        const aggregates = await buildDailyAggregates(dayStart, dayEnd, undefined, branchId)

        record = await db.dailySalesRecord.update({
          where: { id: record.id },
          data: { ...aggregates },
          include: recordInclude,
        })
      }

      const todaySales = await db.sale.findMany({
        where: {
          createdAt: dayRange,
          branchId,
          ...(userFilter ? { userId: userFilter } : {}),
        },
        include: saleInclude,
        orderBy: { createdAt: 'desc' },
      })

      return NextResponse.json({
        scope: 'branch',
        date: todayStr,
        branches: [
          {
            branch: record?.branch ?? { id: branchId, name: 'This branch', code: '' },
            record: flattenRecord(record),
            sales: todaySales.map(flattenSale),
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
    const [records, sales] = await Promise.all([
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
    ])

    const recordsByBranch = new Map(records.map((r) => [r.branchId, r]))
    const salesByBranch = new Map<string, any[]>()
    for (const sale of sales) {
      const list = salesByBranch.get(sale.branchId)
      if (list) list.push(sale)
      else salesByBranch.set(sale.branchId, [sale])
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
          // A branch that traded today but has no register row yet still has to
          // show its takings, otherwise the owner sees an empty card next to a
          // branch that is visibly busy in the POS. Derived from the same sales
          // rows above, and clearly marked as not yet a register.
          liveTotals: record ? null : deriveTotals(branchSales),
        }
      }),
    })
  } catch (error) {
    console.error('Daily sales today error:', error)
    return NextResponse.json({ error: 'Failed to fetch today\'s sales record' }, { status: 500 })
  }
}

/**
 * Register-shaped totals computed from a day's sales.
 *
 * Used only for the consolidated view, where a branch may have taken money
 * without a register row existing. Mirrors `buildDailyAggregates` so the numbers
 * a branch shows before its register is opened are the same numbers it will show
 * once one is.
 */
function deriveTotals(sales: any[]): DailyAggregates {
  const amounts = sales.map((s) => ({
    totalAmount: toNumber(s.totalAmount),
    profit: toNumber(s.profit),
    paymentMethod: s.paymentMethod as string,
  }))

  return {
    totalRevenue: amounts.reduce((sum, s) => sum + s.totalAmount, 0),
    totalProfit: amounts.reduce((sum, s) => sum + s.profit, 0),
    totalTransactions: amounts.length,
    totalItemsSold: sales.reduce(
      (sum, s) => sum + (s.items ?? []).reduce((is: number, i: any) => is + i.quantity, 0),
      0
    ),
    cashTotal: amounts.filter((s) => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.totalAmount, 0),
    cardTotal: amounts.filter((s) => s.paymentMethod === 'card').reduce((sum, s) => sum + s.totalAmount, 0),
    mobileMoneyTotal: amounts.filter((s) => s.paymentMethod === 'mobile_money').reduce((sum, s) => sum + s.totalAmount, 0),
  }
}
