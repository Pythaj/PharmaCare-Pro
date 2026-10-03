import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { branchWhere } from '@/lib/branches'
import { toNumber } from '@/lib/utils'
import { localDateKey } from '@/lib/dates'
import {
  aggregateRefundsByProduct,
  fetchRefundLines,
  summarizeRevenue,
} from '@/lib/refunds'

const round2 = (n: number) => Math.round(n * 100) / 100

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Turns a `YYYY-MM-DD` key back into a LOCAL-midnight Date so it can be
 * formatted.
 *
 * `new Date('2026-01-05')` is the trap this avoids: without a time component
 * JavaScript parses that as UTC midnight, so anywhere west of Greenwich the
 * formatter renders it as the 4th. Splitting the key and using the numeric
 * Date constructor keeps it on the intended local day.
 */
function dateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * GET /api/reports
 *
 * Financial reporting — admin only, and branch-scoped like every other money
 * route. An admin parked on Branch A gets Branch A's revenue, its top products
 * and its cashier leaderboard; the consolidated "All branches" view is the only
 * way to see the whole business. Without the boundary this page contradicted
 * itself: the header would read one shop while the totals summed the chain.
 */
export async function GET(request: NextRequest) {
  // Financial reporting — admin only
  const auth = await requireBranchScope(request, { admin: true })
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period')
    const fromStr = searchParams.get('from')
    const toStr = searchParams.get('to')

    const now = new Date()
    let startDate: Date
    let isYearlyView = false

    if (fromStr && toStr) {
      startDate = new Date(fromStr + 'T00:00:00')
      now.setTime(new Date(toStr + 'T23:59:59').getTime())
    } else {
      switch (period) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          break
        case 'this_week': {
          const dayOfWeek = now.getDay()
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek)
          break
        }
        case 'this_month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1)
          break
        case 'this_year':
          startDate = new Date(now.getFullYear(), 0, 1)
          isYearlyView = true
          break
        default:
          startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      }
    }

    const endDate = new Date(now)
    endDate.setHours(23, 59, 59, 999)

    const sales = await db.sale.findMany({
      where: {
        ...branchWhere(auth.scope!),
        createdAt: { gte: startDate, lte: endDate },
        status: 'completed',
      },
      include: {
        items: { include: { product: { select: { name: true } } } },
        user: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    // --- Aggregate Stats ---
    // Money columns are Decimal. Flatten once so every aggregate below is
    // plain number arithmetic and serialises as JSON numbers.
    const rows = sales.map((sale) => ({
      ...sale,
      totalAmount: toNumber(sale.totalAmount),
      profit: toNumber(sale.profit),
    }))

    const totalRevenue = rows.reduce((sum, s) => sum + s.totalAmount, 0)
    const totalProfit = rows.reduce((sum, s) => sum + s.profit, 0)
    const totalSales = rows.length
    const totalItemsSold = rows.reduce(
      (sum, s) => sum + s.items.reduce((i, item) => i + item.quantity, 0),
      0
    )

    // Refunds for the same range and scope, fetched once and folded into every
    // view below. Every revenue figure this report shows is NET; the gross it
    // came from is kept beside it, because "we took 4,000 and gave 300 back" is
    // a sentence an owner needs and a bare 3,700 does not tell them which of the
    // two happened.
    const refundLines = await fetchRefundLines(
      { gte: startDate, lte: endDate },
      { branchId: auth.scope!.branchId }
    )
    const summary = summarizeRevenue({ revenue: totalRevenue, profit: totalProfit }, refundLines)

    // Refunds per day / per tender / per seller / per product, folded once into
    // maps the views below read. Doing it per view would mean five passes over the
    // same rows and five chances to disagree about the same refund.
    const refundsByDay = new Map<string, { refunds: number; profit: number }>()
    const refundsByTender = new Map<string, number>()
    const refundsBySeller = new Map<string, { refunds: number; profit: number }>()
    for (const refund of refundLines) {
      const dayKey = localDateKey(refund.createdAt)
      const day = refundsByDay.get(dayKey) ?? { refunds: 0, profit: 0 }
      day.refunds += refund.totalRefund
      day.profit += refund.refundedProfit
      refundsByDay.set(dayKey, day)

      const tender = refund.paymentMethod || 'cash'
      refundsByTender.set(tender, (refundsByTender.get(tender) ?? 0) + refund.totalRefund)

      // Matches the "deleted user" key the cashier breakdown uses, so a refund
      // of a deleted cashier's sale lands in the same bucket as the sale itself.
      const sellerKey = refund.sellerId ?? 'deleted-user'
      const seller = refundsBySeller.get(sellerKey) ?? { refunds: 0, profit: 0 }
      seller.refunds += refund.totalRefund
      seller.profit += refund.refundedProfit
      refundsBySeller.set(sellerKey, seller)
    }
    const refundsByProduct = aggregateRefundsByProduct(refundLines)

    // --- Revenue Chart Data (by day) ---
    // Grouped on the ISO local-day KEY, never on a formatted label.
    //
    // This used to bucket on `toLocaleDateString('en-US', { month: 'short',
    // day: 'numeric' })`, which produces "Jan 5" with no year. On a `this_year`
    // report — or any range longer than twelve months — 5 Jan and 5 Jan of the
    // following year produced the SAME key, so the second day's takings
    // overwrote the first and the chart, the CSV and the print export all
    // reported a number that was never true. Grouping on `YYYY-MM-DD` makes the
    // collision structurally impossible; the short label is applied afterwards
    // and is presentation only.
    const revenueByDay = new Map<string, { gross: number; refunds: number }>()
    for (const sale of rows) {
      const key = localDateKey(sale.createdAt)
      const entry = revenueByDay.get(key) ?? { gross: 0, refunds: 0 }
      entry.gross += sale.totalAmount
      revenueByDay.set(key, entry)
    }
    // A day whose only activity was refunds still belongs on the chart: without
    // this it would vanish, and the line would jump straight across the hole.
    for (const [key, value] of refundsByDay) {
      const entry = revenueByDay.get(key) ?? { gross: 0, refunds: 0 }
      entry.refunds += value.refunds
      revenueByDay.set(key, entry)
    }

    // With the buckets now correctly separate, two "Jan 5" labels would be
    // ambiguous — so the year is shown only when the data really does span
    // more than one, keeping the common single-year chart uncluttered.
    const yearsInRange = new Set([...revenueByDay.keys()].map((k) => k.slice(0, 4)))
    const spansMultipleYears = yearsInRange.size > 1

    const revenueData = [...revenueByDay.entries()]
      // Chronological. The old object-literal approach relied on insertion
      // order, which is the order Prisma returned rows in — not the order the
      // chart should read.
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({
        name: dateFromKey(key).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          ...(spansMultipleYears ? { year: 'numeric' as const } : {}),
        }),
        value: value.gross - value.refunds,
        gross: value.gross,
        refunds: value.refunds,
      }))

    // --- Payment Method Distribution ---
    const paymentByMethod: Record<string, number> = {}
    for (const sale of rows) {
      const key = sale.paymentMethod || 'cash'
      paymentByMethod[key] = (paymentByMethod[key] ?? 0) + sale.totalAmount
    }
    // Net of refunds, bucketed by the tender the refund was paid back in. A
    // "card 4,200" bar sitting beside two hundred of card refunds is the figure
    // that tells an owner their terminal mix is not what they think it is.
    for (const [tender, amount] of refundsByTender) {
      const key = tender || 'cash'
      paymentByMethod[key] = (paymentByMethod[key] ?? 0) - amount
    }
    const paymentData = Object.entries(paymentByMethod)
      // A tender whose takings were entirely refunded nets to zero. Showing a
      // zero-length bar is honest; dropping the row would hide the activity.
      .map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' '),
        value: round2(value),
      }))

    // --- Top Products ---
    // Keyed by PRODUCT ID, not by name, so the refund attribution below cannot
    // land on the wrong row when two products share a name.
    const productSales = new Map<
      string,
      { id: string; name: string; quantity: number; revenue: number; refunds: number; refundedQuantity: number }
    >()
    for (const sale of rows) {
      for (const item of sale.items) {
        const pName = item.product?.name ?? 'Unknown'
        const key = item.productId ?? pName
        const entry = productSales.get(key) ?? {
          id: item.productId ?? key,
          name: pName,
          quantity: 0,
          revenue: 0,
          refunds: 0,
          refundedQuantity: 0,
        }
        entry.quantity += item.quantity
        entry.revenue += toNumber(item.total)
        productSales.set(key, entry)
      }
    }
    // Net revenue and net quantity per product. A drug that sells 500 units and
    // comes back 400 times is not the shop's best seller, it is its most
    // expensive mistake — and ranked on gross it would sit at the top.
    for (const [productId, totals] of refundsByProduct) {
      const entry = productSales.get(productId)
      if (!entry) continue
      entry.refunds += totals.refundAmount
      entry.refundedQuantity += totals.quantity
    }

    const topProducts = [...productSales.values()]
      .sort((a, b) => b.quantity - b.refundedQuantity - (a.quantity - a.refundedQuantity))
      .slice(0, 10)
      .map((entry) => ({
        name: entry.name,
        quantity: entry.quantity,
        revenue: entry.revenue,
        refunds: entry.refunds,
        refundedQuantity: entry.refundedQuantity,
        netQuantity: entry.quantity - entry.refundedQuantity,
        netRevenue: entry.revenue - entry.refunds,
      }))

    // --- Best Selling Product ---
    const bestProduct = topProducts.length > 0 ? topProducts[0] : null

    // --- Daily Breakdown ---
    const dailyMap: Record<
      string,
      {
        date: string
        sales: number
        revenue: number
        profit: number
        items: number
        refunds: number
        refundedProfit: number
      }
    > = {}

    for (const sale of rows) {
      const dateKey = localDateKey(sale.createdAt)
      if (!dailyMap[dateKey]) {
        dailyMap[dateKey] = {
          date: dateKey,
          sales: 0,
          revenue: 0,
          profit: 0,
          items: 0,
          refunds: 0,
          refundedProfit: 0,
        }
      }
      dailyMap[dateKey].sales += 1
      dailyMap[dateKey].revenue += sale.totalAmount
      dailyMap[dateKey].profit += sale.profit
      dailyMap[dateKey].items += sale.items.reduce((i, item) => i + item.quantity, 0)
    }
    for (const [dateKey, value] of refundsByDay) {
      if (!dailyMap[dateKey]) {
        dailyMap[dateKey] = {
          date: dateKey,
          sales: 0,
          revenue: 0,
          profit: 0,
          items: 0,
          refunds: 0,
          refundedProfit: 0,
        }
      }
      dailyMap[dateKey].refunds += value.refunds
      dailyMap[dateKey].refundedProfit += value.profit
    }
    const dailyBreakdown = Object.values(dailyMap)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((day) => ({
        ...day,
        netRevenue: round2(day.revenue - day.refunds),
        netProfit: round2(day.profit - day.refundedProfit),
      }))

    // --- Cashier Performance ---
    const cashierMap: Record<
      string,
      {
        userId: string
        name: string
        sales: number
        revenue: number
        profit: number
        refunds: number
        refundedProfit: number
      }
    > = {}

    for (const sale of rows) {
      // A deleted cashier leaves userId null. Indexing the map with null
      // collapsed every such sale into one "null" bucket, so one phantom
      // cashier absorbed the revenue of all of them.
      const uid = sale.userId ?? 'deleted-user'
      const uname = sale.user?.name ?? 'Deleted user'
      if (!cashierMap[uid]) {
        cashierMap[uid] = {
          userId: uid,
          name: uname,
          sales: 0,
          revenue: 0,
          profit: 0,
          refunds: 0,
          refundedProfit: 0,
        }
      }
      cashierMap[uid].sales += 1
      cashierMap[uid].revenue += sale.totalAmount
      cashierMap[uid].profit += sale.profit
    }
    for (const [sellerKey, value] of refundsBySeller) {
      if (!cashierMap[sellerKey]) {
        cashierMap[sellerKey] = {
          userId: sellerKey,
          name: 'Deleted user',
          sales: 0,
          revenue: 0,
          profit: 0,
          refunds: 0,
          refundedProfit: 0,
        }
      }
      cashierMap[sellerKey].refunds += value.refunds
      cashierMap[sellerKey].refundedProfit += value.profit
    }
    const cashierPerformance = Object.values(cashierMap)
      .map((cashier) => ({
        ...cashier,
        netRevenue: round2(cashier.revenue - cashier.refunds),
        netProfit: round2(cashier.profit - cashier.refundedProfit),
      }))
      // Ranked on what they actually banked, so a till propped up by sales that
      // came back does not outrank the one that kept the money.
      .sort((a, b) => b.netRevenue - a.netRevenue)

    // --- Monthly Summary (only for yearly or long custom ranges) ---
    const startMonth = startDate.getMonth()
    const endMonth = endDate.getMonth()
    const startYear = startDate.getFullYear()
    const endYear = endDate.getFullYear()
    const spansMultipleMonths =
      startYear !== endYear || endMonth - startMonth >= 2 || isYearlyView

    let monthlySummary: {
      month: string
      monthIndex: number
      year: number
      revenue: number
      profit: number
      sales: number
      items: number
      refunds: number
      refundedProfit: number
      netRevenue: number
      netProfit: number
    }[] = []

    if (spansMultipleMonths) {
      const monthMap: Record<
        string,
        {
          month: string
          monthIndex: number
          year: number
          revenue: number
          profit: number
          sales: number
          items: number
          refunds: number
          refundedProfit: number
        }
      > = {}

      for (const sale of rows) {
        const mIdx = sale.createdAt.getMonth()
        const yr = sale.createdAt.getFullYear()
        const key = `${yr}-${mIdx}`
        if (!monthMap[key]) {
          monthMap[key] = {
            month: MONTH_NAMES[mIdx],
            monthIndex: mIdx,
            year: yr,
            revenue: 0,
            profit: 0,
            sales: 0,
            items: 0,
            refunds: 0,
            refundedProfit: 0,
          }
        }
        monthMap[key].revenue += sale.totalAmount
        monthMap[key].profit += sale.profit
        monthMap[key].sales += 1
        monthMap[key].items += sale.items.reduce((i, item) => i + item.quantity, 0)
      }

      for (const refund of refundLines) {
        const mIdx = refund.createdAt.getMonth()
        const yr = refund.createdAt.getFullYear()
        const key = `${yr}-${mIdx}`
        if (!monthMap[key]) {
          monthMap[key] = {
            month: MONTH_NAMES[mIdx],
            monthIndex: mIdx,
            year: yr,
            revenue: 0,
            profit: 0,
            sales: 0,
            items: 0,
            refunds: 0,
            refundedProfit: 0,
          }
        }
        monthMap[key].refunds += refund.totalRefund
        monthMap[key].refundedProfit += refund.refundedProfit
      }

      monthlySummary = Object.values(monthMap)
        .map((month) => ({
          ...month,
          netRevenue: round2(month.revenue - month.refunds),
          netProfit: round2(month.profit - month.refundedProfit),
        }))
        .sort((a, b) => {
          if (a.year !== b.year) return a.year - b.year
          return a.monthIndex - b.monthIndex
        })
    }

    return NextResponse.json({
      // Lets the report page label its own totals instead of implying a scope
      // it may not be in. The name is not repeated here — the client already
      // holds it from the session bootstrap, and a second source for the same
      // label is a second thing to get out of step.
      branchId: auth.scope!.branchId,
      scope: auth.scope!.branchId ? 'branch' : 'all',
      stats: {
        // NET is the headline; gross and refunds travel with it so the figure can
        // be audited rather than merely trusted.
        totalRevenue: summary.netRevenue,
        grossRevenue: summary.grossRevenue,
        totalRefunds: summary.totalRefunds,
        refundCount: summary.refundCount,
        totalProfit: summary.netProfit,
        grossProfit: summary.grossProfit,
        refundedProfit: summary.refundedProfit,
        totalSales,
        totalItemsSold,
        // Average of what was KEPT, not of what was taken: dividing by the same
        // sale count with the net revenue keeps the ratio describing the same
        // money the figure above reports.
        avgSaleValue: Number(summary.netRevenue / (totalSales || 1)),
        bestProduct: bestProduct ? {
          ...bestProduct,
          quantity: Number(bestProduct.quantity),
          revenue: Number(bestProduct.revenue),
          netRevenue: Number(bestProduct.netRevenue),
        } : null,
      },
      revenueData: revenueData.map((d) => ({
        name: d.name,
        value: Number(round2(d.value)),
        gross: Number(round2(d.gross)),
        refunds: Number(round2(d.refunds)),
      })),
      paymentData: paymentData.map((d) => ({ name: d.name, value: Number(d.value) })),
      topProducts: topProducts.map((p) => ({
        name: p.name,
        quantity: Number(p.quantity),
        revenue: Number(round2(p.revenue)),
        refunds: Number(round2(p.refunds)),
        refundedQuantity: Number(p.refundedQuantity),
        netQuantity: Number(p.netQuantity),
        netRevenue: Number(round2(p.netRevenue)),
      })),
      dailyBreakdown: dailyBreakdown.map((d) => ({
        ...d,
        revenue: Number(round2(d.revenue)),
        profit: Number(round2(d.profit)),
        refunds: Number(round2(d.refunds)),
        netRevenue: Number(round2(d.netRevenue)),
        netProfit: Number(round2(d.netProfit)),
      })),
      cashierPerformance: cashierPerformance.map((c) => ({
        ...c,
        revenue: Number(round2(c.revenue)),
        profit: Number(round2(c.profit)),
        refunds: Number(round2(c.refunds)),
        netRevenue: Number(round2(c.netRevenue)),
        netProfit: Number(round2(c.netProfit)),
      })),
      monthlySummary: monthlySummary.map((m) => ({
        ...m,
        revenue: Number(round2(m.revenue)),
        profit: Number(round2(m.profit)),
        refunds: Number(round2(m.refunds)),
        netRevenue: Number(round2(m.netRevenue)),
        netProfit: Number(round2(m.netProfit)),
      })),
    })
  } catch (error) {
    console.error('Reports fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch report data' }, { status: 500 })
  }
}