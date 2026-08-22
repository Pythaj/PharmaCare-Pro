import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/require-auth'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export async function GET(request: NextRequest) {
  // Financial reporting — admin only
  const auth = await requireAdmin(request)
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
        createdAt: { gte: startDate, lte: endDate },
        status: 'completed',
      },
      include: {
        items: { include: { product: { select: { name: true } } } },
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    // --- Aggregate Stats ---
    const totalRevenue = sales.reduce((sum, s) => sum + s.totalAmount, 0)
    const totalProfit = sales.reduce((sum, s) => sum + s.profit, 0)
    const totalSales = sales.length
    const totalItemsSold = sales.reduce(
      (sum, s) => sum + s.items.reduce((i, item) => i + item.quantity, 0),
      0
    )
    const avgSaleValue = totalSales > 0 ? totalRevenue / totalSales : 0

    // --- Revenue Chart Data (by day) ---
    const revenueByDay: Record<string, number> = {}
    for (const sale of sales) {
      const day = sale.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      revenueByDay[day] = (revenueByDay[day] ?? 0) + sale.totalAmount
    }
    const revenueData = Object.entries(revenueByDay).map(([name, value]) => ({ name, value }))

    // --- Payment Method Distribution ---
    const paymentByMethod: Record<string, number> = {}
    for (const sale of sales) {
      const key = sale.paymentMethod || 'cash'
      paymentByMethod[key] = (paymentByMethod[key] ?? 0) + sale.totalAmount
    }
    const paymentData = Object.entries(paymentByMethod).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' '),
      value,
    }))

    // --- Top Products ---
    const productSales: Record<string, { quantity: number; revenue: number }> = {}
    for (const sale of sales) {
      for (const item of sale.items) {
        const pName = item.product?.name ?? 'Unknown'
        if (!productSales[pName]) productSales[pName] = { quantity: 0, revenue: 0 }
        productSales[pName].quantity += item.quantity
        productSales[pName].revenue += item.total
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

    for (const sale of sales) {
      const dateKey = toDateString(sale.createdAt)
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

    for (const sale of sales) {
      const uid = sale.userId
      const uname = sale.user?.name ?? 'Unknown'
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

      for (const sale of sales) {
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
      stats: {
        totalRevenue,
        totalProfit,
        totalSales,
        totalItemsSold,
        avgSaleValue,
        bestProduct,
      },
      revenueData,
      paymentData,
      topProducts,
      dailyBreakdown,
      cashierPerformance,
      monthlySummary,
    })
  } catch (error) {
    console.error('Reports fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch report data' }, { status: 500 })
  }
}