import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || 'this_month'

    const now = new Date()
    let startDate = new Date(now.getFullYear(), now.getMonth(), 1)

    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        break
      case 'this_week':
        const dayOfWeek = now.getDay()
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek)
        break
      case 'this_month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1)
        break
      case 'this_year':
        startDate = new Date(now.getFullYear(), 0, 1)
        break
    }

    const sales = await db.sale.findMany({
      where: { createdAt: { gte: startDate }, status: 'completed' },
      include: {
        items: { include: { product: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    })

    const totalRevenue = sales.reduce((sum, s) => sum + s.totalAmount, 0)
    const totalProfit = sales.reduce((sum, s) => sum + s.profit, 0)
    const totalSales = sales.length
    const totalItemsSold = sales.reduce((sum, s) => sum + s.items.reduce((i, item) => i + item.quantity, 0), 0)

    // Revenue by day for chart
    const revenueByDay: Record<string, number> = {}
    const profitByDay: Record<string, number> = {}
    for (const sale of sales) {
      const day = sale.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      revenueByDay[day] = (revenueByDay[day] ?? 0) + sale.totalAmount
      profitByDay[day] = (profitByDay[day] ?? 0) + sale.profit
    }
    const revenueData = Object.entries(revenueByDay).map(([name, value]) => ({ name, value }))

    // Payment method distribution
    const paymentByMethod: Record<string, number> = {}
    for (const sale of sales) {
      paymentByMethod[sale.paymentMethod] = (paymentByMethod[sale.paymentMethod] ?? 0) + sale.totalAmount
    }
    const paymentData = Object.entries(paymentByMethod).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1).replace('_', ' '),
      value,
    }))

    // Top products
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

    return NextResponse.json({
      stats: { totalRevenue, totalProfit, totalSales, totalItemsSold },
      revenueData,
      paymentData,
      topProducts,
    })
  } catch (error) {
    console.error('Reports fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch report data' }, { status: 500 })
  }
}