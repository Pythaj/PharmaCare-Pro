import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { branchWhere } from '@/lib/branches'
import { getExpiryAlertDays } from '@/lib/server-settings'
import { aggregateRefundMoney, fetchRefundLines } from '@/lib/refunds'
import { computeAlertCounts } from '@/lib/stock-alert-counts'

const round2 = (n: number) => Math.round(n * 100) / 100

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

    const [
      todaySalesResult,
      weeklySalesResult,
      monthlySalesResult,
      totalRevenueResult,
      totalProfitResult,
      todayTransactionsResult,
      todaySaleItemsResult,
      todayRefundsResult,
      weeklyRefundsResult,
      monthlyRefundsResult,
      totalRefundsResult,
      refundLines,
      stockBatches,
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
      // Refunds for each revenue window. Without these the tiles were gross
      // only, so a branch whose returns were climbing looked like it was trading
      // better than it was — the same mistake the register had with its cash.
      // Scoped to the SELLER (not the operator who processed the refund) so a
      // salesperson's "my takings" stay their own.
      aggregateRefundMoney({ gte: today }, ownerScope),
      aggregateRefundMoney({ gte: sevenDaysAgo }, ownerScope),
      aggregateRefundMoney({ gte: thirtyDaysAgo }, ownerScope),
      aggregateRefundMoney(undefined, ownerScope),
      // Margin given back all-time. This one has to read the refund LINES: margin
      // lives on the sale items, so `_sum` over `Return.totalRefund` can only
      // ever describe the cash. One extra query for the profit tile is cheaper
      // than shipping a profit figure that silently means something else.
      fetchRefundLines(undefined, ownerScope),
      // Only batches that still hold stock can contribute value.
      db.batch.findMany({
        where: { ...stockScope, quantity: { gt: 0 } },
        select: { quantity: true, costPrice: true },
      }),
      db.batch.count({
        where: { ...stockScope, ...since(today) },
      }),
    ])

    // Low-stock and expiry counts are shared with the header's
    // `/api/dashboard/alerts-count`, which the bell polls from every page. One
    // implementation, so the badge and this tile can never warn about different
    // windows or disagree about what counts as "low".
    const {
      lowStockCount,
      expiringCount,
      expiredCount,
      productsInStock,
    } = await computeAlertCounts(db, {
      stockWhere: stockScope,
      branchId: auth.scope!.branchId ?? null,
      expiryHorizon,
      now,
    })

    const totalInventoryValue = stockBatches.reduce(
      (sum, b) => sum + b.quantity * Number(b.costPrice),
      0
    )

    const refundedProfit = round2(
      refundLines.reduce((sum, line) => sum + line.refundedProfit, 0)
    )
    const grossProfit = Number(totalProfitResult._sum.profit || 0)

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
      totalProfit: grossProfit,
      grossProfit,
      refundedProfit,
      netProfit: round2(grossProfit - refundedProfit),
      // Gross stays, net is the headline. A tile showing only net would hide how
      // much was refunded; a tile showing only gross would overstate the
      // business. Every revenue figure above now has its net counterpart, named
      // so the UI cannot label one with the other's meaning.
      todayRefunds: todayRefundsResult.totalRefunds,
      weeklyRefunds: weeklyRefundsResult.totalRefunds,
      monthlyRefunds: monthlyRefundsResult.totalRefunds,
      totalRefunds: totalRefundsResult.totalRefunds,
      todayRefundCount: todayRefundsResult.refundCount,
      weeklyRefundCount: weeklyRefundsResult.refundCount,
      monthlyRefundCount: monthlyRefundsResult.refundCount,
      totalRefundCount: totalRefundsResult.refundCount,
      todayNetSales: round2(Number(todaySalesResult._sum.totalAmount || 0) - todayRefundsResult.totalRefunds),
      weeklyNetSales: round2(Number(weeklySalesResult._sum.totalAmount || 0) - weeklyRefundsResult.totalRefunds),
      monthlyNetSales: round2(Number(monthlySalesResult._sum.totalAmount || 0) - monthlyRefundsResult.totalRefunds),
      netRevenue: round2(Number(totalRevenueResult._sum.totalAmount || 0) - totalRefundsResult.totalRefunds),
      totalInventoryValue: Number(totalInventoryValue),
      productsInStock,
      lowStockCount,
      expiringCount,
      expiredCount,
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
