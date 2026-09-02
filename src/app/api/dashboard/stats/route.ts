import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'

// All roles may read dashboard stats (sales staff see personal metrics)
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
    const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

    // Run all queries in parallel
    const [
      todaySalesResult,
      weeklySalesResult,
      monthlySalesResult,
      totalRevenueResult,
      totalProfitResult,
      allBatches,
      products,
      batchesWithProduct,
      expiringBatches,
      todayTransactionsResult,
      todaySaleItemsResult,
      todayBatchesResult,
    ] = await Promise.all([
      // Today's sales
      db.sale.aggregate({
        where: { createdAt: { gte: today } },
        _sum: { totalAmount: true },
      }),
      // Weekly sales
      db.sale.aggregate({
        where: { createdAt: { gte: sevenDaysAgo } },
        _sum: { totalAmount: true },
      }),
      // Monthly sales
      db.sale.aggregate({
        where: { createdAt: { gte: thirtyDaysAgo } },
        _sum: { totalAmount: true },
      }),
      // Total revenue
      db.sale.aggregate({
        _sum: { totalAmount: true },
      }),
      // Total profit
      db.sale.aggregate({
        _sum: { profit: true },
      }),
      // All batches for inventory value
      db.batch.findMany({ select: { quantity: true, costPrice: true } }),
      // All active products
      db.product.findMany({ where: { active: true } }),
      // Batches with product info for stock calculations
      db.batch.findMany({
        include: { product: true },
      }),
      // Expiring batches (within 90 days)
      db.batch.count({
        where: {
          expiryDate: { lte: ninetyDaysFromNow },
          quantity: { gt: 0 },
        },
      }),
      // Today's transaction count
      db.sale.count({
        where: { createdAt: { gte: today } },
      }),
      // Products sold today
      db.saleItem.aggregate({
        where: {
          sale: { createdAt: { gte: today } },
        },
        _sum: { quantity: true },
      }),
      // Stock received today
      db.batch.count({
        where: { createdAt: { gte: today } },
      }),
    ])

    // Calculate total inventory value
    const totalInventoryValue = allBatches.reduce(
      (sum, b) => sum + b.quantity * b.costPrice,
      0
    )

    // Calculate stock per product
    const productStock = new Map<string, number>()
    for (const batch of batchesWithProduct) {
      const current = productStock.get(batch.productId) || 0
      productStock.set(batch.productId, current + batch.quantity)
    }

    // Products in stock (total qty > 0)
    const productsInStock = products.filter(
      (p) => (productStock.get(p.id) || 0) > 0
    ).length

    // Low stock count: in stock but at or below reorder level (excludes zero-stock)
    const lowStockCount = products.filter((p) => {
      const stock = productStock.get(p.id) || 0;
      return stock > 0 && stock <= p.reorderLevel;
    }).length

    return NextResponse.json({
      todaySales: todaySalesResult._sum.totalAmount || 0,
      weeklySales: weeklySalesResult._sum.totalAmount || 0,
      monthlySales: monthlySalesResult._sum.totalAmount || 0,
      totalRevenue: totalRevenueResult._sum.totalAmount || 0,
      totalProfit: totalProfitResult._sum.profit || 0,
      totalInventoryValue,
      productsInStock,
      lowStockCount,
      expiringCount: expiringBatches,
      todayTransactions: todayTransactionsResult,
      productsSoldToday: todaySaleItemsResult._sum.quantity || 0,
      stockReceivedToday: todayBatchesResult,
    })
  } catch (error) {
    console.error('Dashboard stats error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch dashboard stats' },
      { status: 500 }
    )
  }
}
