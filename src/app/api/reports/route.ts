import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { branchWhere } from '@/lib/branches'
import { toNumber } from '@/lib/utils'
import { localDateKey } from '@/lib/dates'

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
    const avgSaleValue = totalSales > 0 ? totalRevenue / totalSales : 0

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
    const revenueByDay = new Map<string, number>()
    for (const sale of rows) {
      const key = localDateKey(sale.createdAt)
      revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + sale.totalAmount)
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
        value,
      }))

    // --- Payment Method Distribution ---
    const paymentByMethod: Record<string, number> = {}
    for (const sale of rows) {
      const key = sale.paymentMethod || 'cash'
      paymentByMethod[key] = (paymentByMethod[key] ?? 0) + sale.totalAmount
    }
    const paymentData = Object.entries(paymentByMethod).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' '),
      value,
    }))

    // --- Top Products ---
    const productSales: Record<string, { quantity: number; revenue: number }> = {}
    for (const sale of rows) {
      for (const item of sale.items) {
        const pName = item.product?.name ?? 'Unknown'
        if (!productSales[pName]) productSales[pName] = { quantity: 0, revenue: 0 }
        productSales[pName].quantity += item.quantity
        productSales[pName].revenue += toNumber(item.total)
      }
    }
    const topProducts = Object.entries(productSales)
      .sort((a, b) => b[1].quantity - a[1].quantity)
      .slice(0, 10)
      .map(([name, data]) => ({ name, ...data }))

    // --- Best Selling Product ---
    const bestProduct = topProducts.length > 0 ? topProducts[0] : null

    // --- Daily Breakdown ---
    const dailyMap: Record<
      string,
      { date: string; sales: number; revenue: number; profit: number; items: number }
    > = {}

    for (const sale of rows) {
      const dateKey = localDateKey(sale.createdAt)
      if (!dailyMap[dateKey]) {
        dailyMap[dateKey] = { date: dateKey, sales: 0, revenue: 0, profit: 0, items: 0 }
      }
      dailyMap[dateKey].sales += 1
      dailyMap[dateKey].revenue += sale.totalAmount
      dailyMap[dateKey].profit += sale.profit
      dailyMap[dateKey].items += sale.items.reduce((i, item) => i + item.quantity, 0)
    }
    const dailyBreakdown = Object.values(dailyMap).sort((a, b) => b.date.localeCompare(a.date))

    // --- Cashier Performance ---
    const cashierMap: Record<
      string,
      { userId: string; name: string; sales: number; revenue: number; profit: number }
    > = {}

    for (const sale of rows) {
      // A deleted cashier leaves userId null. Indexing the map with null
      // collapsed every such sale into one "null" bucket, so one phantom
      // cashier absorbed the revenue of all of them.
      const uid = sale.userId ?? 'deleted-user'
      const uname = sale.user?.name ?? 'Deleted user'
      if (!cashierMap[uid]) {
        cashierMap[uid] = { userId: uid, name: uname, sales: 0, revenue: 0, profit: 0 }
      }
      cashierMap[uid].sales += 1
      cashierMap[uid].revenue += sale.totalAmount
      cashierMap[uid].profit += sale.profit
    }
    const cashierPerformance = Object.values(cashierMap).sort((a, b) => b.revenue - a.revenue)

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
          }
        }
        monthMap[key].revenue += sale.totalAmount
        monthMap[key].profit += sale.profit
        monthMap[key].sales += 1
        monthMap[key].items += sale.items.reduce((i, item) => i + item.quantity, 0)
      }

      monthlySummary = Object.values(monthMap).sort((a, b) => {
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
        totalRevenue: Number(totalRevenue),
        totalProfit: Number(totalProfit),
        totalSales,
        totalItemsSold,
        avgSaleValue: Number(avgSaleValue),
        bestProduct: bestProduct ? {
          ...bestProduct,
          quantity: Number(bestProduct.quantity),
          revenue: Number(bestProduct.revenue),
        } : null,
      },
      revenueData: revenueData.map((d) => ({ name: d.name, value: Number(d.value) })),
      paymentData: paymentData.map((d) => ({ name: d.name, value: Number(d.value) })),
      topProducts: topProducts.map((p) => ({
        name: p.name,
        quantity: Number(p.quantity),
        revenue: Number(p.revenue),
      })),
      dailyBreakdown: dailyBreakdown.map((d) => ({
        ...d,
        revenue: Number(d.revenue),
        profit: Number(d.profit),
      })),
      cashierPerformance: cashierPerformance.map((c) => ({
        ...c,
        revenue: Number(c.revenue),
        profit: Number(c.profit),
      })),
      monthlySummary: monthlySummary.map((m) => ({
        ...m,
        revenue: Number(m.revenue),
        profit: Number(m.profit),
      })),
    })
  } catch (error) {
    console.error('Reports fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch report data' }, { status: 500 })
  }
}