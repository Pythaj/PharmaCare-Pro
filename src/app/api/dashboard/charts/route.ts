import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { branchWhere } from '@/lib/branches'
import { localDateKey, localMonthKey, startOfLocalDayOffset, startOfLocalMonthOffset } from '@/lib/dates'
import { fetchRefundLines } from '@/lib/refunds'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * GET /api/dashboard/charts
 *
 * Branch-scoped like /api/dashboard/stats: the charts describe whichever shop
 * the session is on, with the salesperson's own till layered on top for
 * non-admins. Two of these series are actively misleading without it — "top 5
 * selling products" for Branch A is a different list from Branch B's, and a
 * daily revenue line that merged two shops would show a dip on a day one of
 * them was closed. Day buckets are keyed by LOCAL date (lib/dates), so a
 * late-evening sale is no longer filed under the wrong day outside UTC.
 */
export async function GET(request: NextRequest) {
  const auth = await requireBranchScope(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const now = new Date()
    const isAdmin = auth.user!.role === 'admin'
    const branchScope = branchWhere(auth.scope!)
    const ownerScope = isAdmin ? branchScope : { ...branchScope, userId: auth.user!.userId }

    // Daily sales + profit: last 14 local days
    const fourteenDaysAgo = startOfLocalDayOffset(now, 14)
    const dailySalesRaw = await db.sale.findMany({
      where: { ...ownerScope, createdAt: { gte: fourteenDaysAgo } },
      select: { totalAmount: true, profit: true, createdAt: true },
    })

    // Declared up here because the refund fetch below spans the MONTHLY window,
    // which is the wider of the two this route charts.
    const sixMonthsAgo = startOfLocalMonthOffset(now, 5)

    // Refunds over the last 6 months — the wider of the two windows this route
    // charts, fetched ONCE and bucketed locally for both. Asking for fourteen
    // daily sums and six monthly sums would be twenty round trips to compute
    // twenty numbers from the same handful of rows.
    const refundLines = await fetchRefundLines({ gte: sixMonthsAgo }, ownerScope)
    const dailyRefundMap = new Map<string, { refunds: number; profit: number }>()
    for (let i = 13; i >= 0; i--) {
      dailyRefundMap.set(localDateKey(startOfLocalDayOffset(now, i)), { refunds: 0, profit: 0 })
    }
    for (const refund of refundLines) {
      const entry = dailyRefundMap.get(localDateKey(refund.createdAt))
      if (entry) {
        entry.refunds += refund.totalRefund
        entry.profit += refund.refundedProfit
      }
    }

    // Build daily maps keyed by LOCAL date
    const dailySalesMap = new Map<string, { sales: number; profit: number }>()
    for (let i = 13; i >= 0; i--) {
      dailySalesMap.set(localDateKey(startOfLocalDayOffset(now, i)), { sales: 0, profit: 0 })
    }

    for (const sale of dailySalesRaw) {
      const key = localDateKey(sale.createdAt)
      const entry = dailySalesMap.get(key)
      if (entry) {
        entry.sales += Number(sale.totalAmount)
        entry.profit += Number(sale.profit)
      }
    }

    const dailySales: { name: string; value: number }[] = []
    const dailyRevenue: { name: string; gross: number; refunds: number; net: number }[] = []
    const profitTrend: { name: string; value: number; value2: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = startOfLocalDayOffset(now, i)
      const key = localDateKey(d)
      const entry = dailySalesMap.get(key) ?? { sales: 0, profit: 0 }
      const refunded = dailyRefundMap.get(key) ?? { refunds: 0, profit: 0 }
      dailySales.push({
        name: DAY_NAMES[d.getDay()],
        // NET, matching the tile the user reads above the chart. A line that
        // disagreed with its own headline is how a chart stops being believed.
        value: round2(entry.sales - refunded.refunds),
      })
      dailyRevenue.push({
        name: DAY_NAMES[d.getDay()],
        gross: round2(entry.sales),
        refunds: round2(refunded.refunds),
        net: round2(entry.sales - refunded.refunds),
      })
      // The profit trend chart plots sales (value) against profit (value2) on
      // two axes — value2 was never populated, so the second series was flat
      // at zero for its entire life.
      profitTrend.push({
        name: DAY_NAMES[d.getDay()],
        value: round2(entry.sales - refunded.refunds),
        // Profit is reversed by the refund too, not just the revenue: leaving
        // the margin on goods that were given back would report a branch as more
        // profitable than it is, precisely when its returns are worst.
        value2: round2(entry.profit - refunded.profit),
      })
    }

    // Monthly revenue: last 6 local months
    const monthlySalesRaw = await db.sale.findMany({
      where: { ...ownerScope, createdAt: { gte: sixMonthsAgo } },
      select: { totalAmount: true, createdAt: true },
    })

    const monthlyRevenueMap = new Map<string, { sales: number; refunds: number }>()
    for (let i = 5; i >= 0; i--) {
      monthlyRevenueMap.set(localMonthKey(startOfLocalMonthOffset(now, i)), {
        sales: 0,
        refunds: 0,
      })
    }

    for (const sale of monthlySalesRaw) {
      const key = localMonthKey(sale.createdAt)
      if (monthlyRevenueMap.has(key)) {
        const entry = monthlyRevenueMap.get(key)!
        entry.sales += Number(sale.totalAmount)
      }
    }

    // Buckets the SAME refund rows fetched above into months. No second query: the
    // 6-month range already covers every day on the chart.
    for (const refund of refundLines) {
      const entry = monthlyRevenueMap.get(localMonthKey(refund.createdAt))
      if (entry) entry.refunds += refund.totalRefund
    }

    const monthlyRevenue: { name: string; value: number }[] = []
    const monthlyRevenueDetail: { name: string; gross: number; refunds: number; net: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const m = startOfLocalMonthOffset(now, i)
      const key = localMonthKey(m)
      const entry = monthlyRevenueMap.get(key) ?? { sales: 0, refunds: 0 }
      monthlyRevenue.push({
        name: MONTH_NAMES[m.getMonth()],
        value: round2(entry.sales - entry.refunds),
      })
      monthlyRevenueDetail.push({
        name: MONTH_NAMES[m.getMonth()],
        gross: round2(entry.sales),
        refunds: round2(entry.refunds),
        net: round2(entry.sales - entry.refunds),
      })
    }

    // Top 5 selling products, within the same scope. A "best seller" is a fact
    // about a SHELF, not about the catalogue: Branch A's top seller says nothing
    // about what Branch B actually moves, so this follows the branch boundary
    // for admins instead of falling back to the whole business.
    const topSellingRaw = await db.saleItem.groupBy({
      by: ['productId'],
      where: { sale: ownerScope },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    })

    const productIds = topSellingRaw.map((t) => t.productId)
    const productNames = productIds.length
      ? await db.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true },
        })
      : []

    const productNameMap = new Map(productNames.map((p) => [p.id, p.name]))
    const topSelling = topSellingRaw.map((t) => ({
      name: productNameMap.get(t.productId) || 'Unknown',
      value: t._sum.quantity || 0,
    }))

    return NextResponse.json({
      // Was always just admin-vs-sales, which is now only half the story: an
      // admin can also be parked on a single branch. Say which.
      scope: isAdmin ? (auth.scope!.branchId ? 'branch' : 'all') : 'own',
      branchId: auth.scope!.branchId,
      dailySales,
      monthlyRevenue,
      topSelling,
      profitTrend,
      // The gross/refunds/net split behind those two lines, so the chart can
      // show WHAT came back rather than only that the net dipped.
      dailyRevenue,
      monthlyRevenueDetail,
    })
  } catch (error) {
    console.error('Dashboard charts error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch chart data' },
      { status: 500 }
    )
  }
}
