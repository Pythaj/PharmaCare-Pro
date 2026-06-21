import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export async function GET() {
  try {
    const now = new Date()

    // Daily sales: last 14 days
    const fourteenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14)
    const dailySalesRaw = await db.sale.findMany({
      where: { createdAt: { gte: fourteenDaysAgo } },
      select: { totalAmount: true, profit: true, createdAt: true },
    })

    // Build daily maps
    const dailySalesMap = new Map<string, { sales: number; profit: number }>()
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const key = d.toISOString().split('T')[0]
      dailySalesMap.set(key, { sales: 0, profit: 0 })
    }

    for (const sale of dailySalesRaw) {
      const key = sale.createdAt.toISOString().split('T')[0]
      if (dailySalesMap.has(key)) {
        const entry = dailySalesMap.get(key)!
        entry.sales += sale.totalAmount
        entry.profit += sale.profit
      }
    }

    const dailySales = []
    const profitTrend = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const key = d.toISOString().split('T')[0]
      const entry = dailySalesMap.get(key)!
      dailySales.push({
        name: DAY_NAMES[d.getDay()],
        value: Math.round(entry.sales * 100) / 100,
      })
      profitTrend.push({
        name: DAY_NAMES[d.getDay()],
        value: Math.round(entry.profit * 100) / 100,
      })
    }

    // Monthly revenue: last 6 months
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    const monthlySalesRaw = await db.sale.findMany({
      where: { createdAt: { gte: sixMonthsAgo } },
      select: { totalAmount: true, createdAt: true },
    })

    const monthlyRevenueMap = new Map<string, number>()
    for (let i = 5; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${m.getFullYear()}-${m.getMonth()}`
      monthlyRevenueMap.set(key, 0)
    }

    for (const sale of monthlySalesRaw) {
      const key = `${sale.createdAt.getFullYear()}-${sale.createdAt.getMonth()}`
      if (monthlyRevenueMap.has(key)) {
        monthlyRevenueMap.set(key, (monthlyRevenueMap.get(key) || 0) + sale.totalAmount)
      }
    }

    const monthlyRevenue = []
    for (let i = 5; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${m.getFullYear()}-${m.getMonth()}`
      monthlyRevenue.push({
        name: MONTH_NAMES[m.getMonth()],
        value: Math.round((monthlyRevenueMap.get(key) || 0) * 100) / 100,
      })
    }

    // Top 5 selling products
    const topSellingRaw = await db.saleItem.groupBy({
      by: ['productId'],
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    })

    const productIds = topSellingRaw.map((t) => t.productId)
    const productNames = await db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true },
    })

    const productNameMap = new Map(productNames.map((p) => [p.id, p.name]))
    const topSelling = topSellingRaw.map((t) => ({
      name: productNameMap.get(t.productId) || 'Unknown',
      value: t._sum.quantity || 0,
    }))

    return NextResponse.json({
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
