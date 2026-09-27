import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { branchWhere } from '@/lib/branches'
import { localDateKey, localMonthKey, startOfLocalDayOffset, startOfLocalMonthOffset } from '@/lib/dates'

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
    const profitTrend: { name: string; value: number; value2: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = startOfLocalDayOffset(now, i)
      const entry = dailySalesMap.get(localDateKey(d)) ?? { sales: 0, profit: 0 }
      dailySales.push({
        name: DAY_NAMES[d.getDay()],
        value: round2(entry.sales),
      })
      // The profit trend chart plots sales (value) against profit (value2) on
      // two axes — value2 was never populated, so the second series was flat
      // at zero for its entire life.
      profitTrend.push({
        name: DAY_NAMES[d.getDay()],
        value: round2(entry.sales),
        value2: round2(entry.profit),
      })
    }

    // Monthly revenue: last 6 local months
    const sixMonthsAgo = startOfLocalMonthOffset(now, 5)
    const monthlySalesRaw = await db.sale.findMany({
      where: { ...ownerScope, createdAt: { gte: sixMonthsAgo } },
      select: { totalAmount: true, createdAt: true },
    })

    const monthlyRevenueMap = new Map<string, number>()
    for (let i = 5; i >= 0; i--) {
      monthlyRevenueMap.set(localMonthKey(startOfLocalMonthOffset(now, i)), 0)
    }

    for (const sale of monthlySalesRaw) {
      const key = localMonthKey(sale.createdAt)
      if (monthlyRevenueMap.has(key)) {
        monthlyRevenueMap.set(key, (monthlyRevenueMap.get(key) ?? 0) + Number(sale.totalAmount))
      }
    }

    const monthlyRevenue: { name: string; value: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const m = startOfLocalMonthOffset(now, i)
      monthlyRevenue.push({
        name: MONTH_NAMES[m.getMonth()],
        value: round2(monthlyRevenueMap.get(localMonthKey(m)) ?? 0),
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
    })
  } catch (error) {
    console.error('Dashboard charts error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch chart data' },
      { status: 500 }
    )
  }
}
