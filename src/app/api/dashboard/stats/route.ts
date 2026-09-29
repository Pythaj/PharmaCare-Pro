import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { branchWhere } from '@/lib/branches'
import { getExpiryAlertDays } from '@/lib/server-settings'
import { classifyStock } from '@/lib/inventory-alerts'
import {
  createEffectiveValueResolver,
  loadBranchProductOverrides,
} from '@/lib/branch-product-settings'

/**
 * GET /api/dashboard/stats
 *
 * Every figure here belongs to ONE branch at a time — the one selected in the
 * session — and only the consolidated "All branches" view spans the business.
 *
 * Two boundaries, both required:
 *  - BRANCH. Revenue, profit and transaction counts are sums over Sale, which is
 *    branch-owned. An admin sitting on Branch A must not see Branch B's takings
 *    under a header that says "Branch A".
 *  - USER. A salesperson is further narrowed to their own till records, which is
 *    what makes the numbers on the sales dashboard personal.
 *
 * Stock figures are branch-scoped too, not pharmacy-wide. That comment used to
 * claim otherwise ("a cashier needs to see what is on the shelf"), but stock on
 * another branch's shelf cannot be sold from this till, so counting it would
 * both overstate availability and understate this branch's own reorder needs.
 */
export async function GET(request: NextRequest) {
  const auth = await requireBranchScope(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
    // The expiry horizon follows `notifications.expiryAlertDays` rather than the
    // hardcoded 90, so the dashboard's "expiring soon" tile agrees with the
    // Inventory alerts list — which already reads the setting. Two screens
    // warning about different windows for the same batch is how a pharmacist
    // ends up trusting the one that is quieter.
    const expiryWarningDays = await getExpiryAlertDays()
    const expiryHorizon = new Date(now.getTime() + expiryWarningDays * 24 * 60 * 60 * 1000)

    // Branch boundary applies to everything below; the personal-till boundary
    // is layered on top for non-admins.
    const isAdmin = auth.user!.role === 'admin'
    const branchScope = branchWhere(auth.scope!)
    const ownerScope = isAdmin ? branchScope : { ...branchScope, userId: auth.user!.userId }
    // Batch queries have no `user`, so they take the branch boundary alone.
    const stockScope = branchScope
    const since = (from: Date) => ({ createdAt: { gte: from } })

    // The reorder threshold is per-branch, resolved in one query. On "All
    // branches" this is empty, so every product falls back to the chain-wide
    // `Product.reorderLevel` — the honest answer when there is no single branch
    // to answer for.
    const resolveValues = createEffectiveValueResolver(
      await loadBranchProductOverrides(auth.scope!.branchId)
    )

    const [
      todaySalesResult,
      weeklySalesResult,
      monthlySalesResult,
      totalRevenueResult,
      totalProfitResult,
      todayTransactionsResult,
      todaySaleItemsResult,
      stockBatches,
      productRows,
      stockByProduct,
      expiringSoonBatches,
      expiredBatches,
      todayBatchesResult,
    ] = await Promise.all([
      db.sale.aggregate({
        where: { ...ownerScope, ...since(today) },
        _sum: { totalAmount: true },
      }),
      db.sale.aggregate({
        where: { ...ownerScope, ...since(sevenDaysAgo) },
        _sum: { totalAmount: true },
      }),
      db.sale.aggregate({
        where: { ...ownerScope, ...since(thirtyDaysAgo) },
        _sum: { totalAmount: true },
      }),
      db.sale.aggregate({
        where: ownerScope,
        _sum: { totalAmount: true },
      }),
      db.sale.aggregate({
        where: ownerScope,
        _sum: { profit: true },
      }),
      db.sale.count({
        where: { ...ownerScope, ...since(today) },
      }),
      db.saleItem.aggregate({
        where: { sale: { ...ownerScope, ...since(today) } },
        _sum: { quantity: true },
      }),
      // Only batches that still hold stock can contribute value.
      db.batch.findMany({
        where: { ...stockScope, quantity: { gt: 0 } },
        select: { quantity: true, costPrice: true },
      }),
      // Two columns only — this used to pull every Product field for every product.
      db.product.findMany({
        where: { active: true },
        select: { id: true, reorderLevel: true },
      }),
      // Aggregate in SQL instead of loading every batch row into memory and
      // folding it per product in JS.
      db.batch.groupBy({
        by: ['productId'],
        where: { ...stockScope, quantity: { gt: 0 } },
        _sum: { quantity: true },
      }),
      // Expiring soon: inside the configured window and NOT already expired.
      db.batch.count({
        where: {
          ...stockScope,
          quantity: { gt: 0 },
          expiryDate: { gt: now, lte: expiryHorizon },
        },
      }),
      // Expired: its own count, instead of being lumped in with "expiring".
      db.batch.count({
        where: {
          ...stockScope,
          quantity: { gt: 0 },
          expiryDate: { lte: now },
        },
      }),
      db.batch.count({
        where: { ...stockScope, ...since(today) },
      }),
    ])

    const totalInventoryValue = stockBatches.reduce(
      (sum, b) => sum + b.quantity * Number(b.costPrice),
      0
    )

    const stockByProductId = new Map(
      stockByProduct.map((row) => [row.productId, row._sum.quantity ?? 0])
    )

    let productsInStock = 0
    let lowStockCount = 0
    for (const product of productRows) {
      const stock = stockByProductId.get(product.id) ?? 0
      if (stock > 0) productsInStock += 1
      // The shared classifier, not a fourth inline copy of the rule. It agreed
      // with `classifyStock` today, but duplicating the definition is how the
      // inventory screen and this tile end up disagreeing after one of them is
      // edited. Zero stock is deliberately not "low" — it has its own figure.
      if (classifyStock(stock, resolveValues(product).reorderLevel) === 'low_stock') {
        lowStockCount += 1
      }
    }

    return NextResponse.json({
      // Reflects the boundary the figures were actually computed under. This
      // used to answer 'all' for every admin, so an admin parked on Branch A was
      // told — by the API the UI trusts — that the numbers spanned the business.
      scope: isAdmin ? (auth.scope!.branchId ? 'branch' : 'all') : 'own',
      branchId: auth.scope!.branchId ?? null,
      branch: auth.branch ?? null,
      todaySales: Number(todaySalesResult._sum.totalAmount || 0),
      weeklySales: Number(weeklySalesResult._sum.totalAmount || 0),
      monthlySales: Number(monthlySalesResult._sum.totalAmount || 0),
      totalRevenue: Number(totalRevenueResult._sum.totalAmount || 0),
      totalProfit: Number(totalProfitResult._sum.profit || 0),
      totalInventoryValue: Number(totalInventoryValue),
      productsInStock,
      lowStockCount,
      expiringCount: expiringSoonBatches,
      expiredCount: expiredBatches,
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
