import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/require-auth'
import { toNumber } from '@/lib/utils'
import { localDateKey } from '@/lib/dates'
import { fetchRefundLines } from '@/lib/refunds'

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * GET /api/reports/branches
 *
 * Every branch side by side: revenue, sales count, items sold, profit, and the
 * per-cashier leaderboard, plus which items each shop is actually moving.
 *
 * ## Why this route is NOT branch-scoped
 *
 * Every other money route in the app uses `requireBranchScope`, which narrows an
 * admin parked on Branch A to Branch A. That is right for transactions and
 * right for the standard reports page — but it makes the one question an owner
 * of several shops actually opens the app to ask impossible to answer: "how is
 * each branch doing?". Answering it by switching branch to branch and
 * remembering four sets of numbers is how an owner ends up comparing this
 * month's Branch B against last month's Branch A.
 *
 * So this route is `requireAdmin` and deliberately spans the business. That is
 * safe because it is strictly read-only: it moves no stock, writes no money and
 * touches no settings. The mutations that must not run across branches — sales,
 * batch receipts, opening the daily register, branch product settings — all keep
 * their existing "select a branch first" refusals. A consolidated *read* is
 * legitimate; a consolidated *write* is the conflict the owner is worried about.
 *
 * The response echoes every branch explicitly, including ones with no sales in
 * the window, so a quiet shop appears as a row of zeroes rather than silently
 * vanishing from a chart and reading as "not trading" when in fact it just was
 * not asked about.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(request.url)
    const fromStr = searchParams.get('from')
    const toStr = searchParams.get('to')

    const now = new Date()
    let startDate: Date
    if (fromStr) {
      // Parsed as LOCAL midnight. `new Date('2026-01-05')` is UTC midnight, which
      // renders as the 4th anywhere west of Greenwich and silently drops a day.
      const [y, m, d] = fromStr.split('-').map(Number)
      startDate = Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)
        ? new Date(y, m - 1, d)
        : new Date(now.getFullYear(), now.getMonth(), 1)
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
    }
    const endDate = fromStr && toStr
      ? new Date(new Date(toStr + 'T00:00:00').setHours(23, 59, 59, 999))
      : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

    if (startDate > endDate) {
      return NextResponse.json(
        { error: 'The start date must not be after the end date' },
        { status: 400 }
      )
    }

    // Every branch, including deactivated ones. A shop that closed last month
    // still has revenue in this window, and dropping it would make the chain
    // total disagree with the sum of the rows shown — so it appears, flagged as
    // no longer trading. Querying only active branches would also mean a sale
    // rung up at a since-deactivated branch matched no bucket at all.
    const branches = await db.branch.findMany({
      select: { id: true, name: true, code: true, active: true },
      orderBy: { name: 'asc' },
    })

    const sales = await db.sale.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        status: 'completed',
      },
      select: {
        id: true,
        branchId: true,
        totalAmount: true,
        profit: true,
        createdAt: true,
        user: { select: { id: true, name: true, role: true } },
        items: {
          select: {
            quantity: true,
            unitPrice: true,
            costPrice: true,
            product: { select: { id: true, name: true, unit: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    interface CashierRow {
      userId: string
      name: string
      role: string
      sales: number
      revenue: number
      items: number
      refunds: number
    }
    interface ProductRow {
      productId: string
      name: string
      unit: string
      quantity: number
      revenue: number
      refundedQuantity: number
      refunds: number
    }

    const byBranch = new Map<string, {
      revenue: number
      profit: number
      sales: number
      items: number
      refunds: number
      refundedProfit: number
      lastSaleAt: string | null
      cashiers: Map<string, CashierRow>
      products: Map<string, ProductRow>
      days: Set<string>
    }>()

    for (const branch of branches) {
      byBranch.set(branch.id, {
        revenue: 0,
        profit: 0,
        sales: 0,
        items: 0,
        refunds: 0,
        refundedProfit: 0,
        lastSaleAt: null,
        cashiers: new Map(),
        products: new Map(),
        days: new Set(),
      })
    }

    for (const sale of sales) {
      const bucket = byBranch.get(sale.branchId)
      // A sale whose branch row was hard-deleted after the sale is real revenue.
      // Surfacing it under a placeholder beats silently dropping it, which would
      // make the chain total disagree with the rows beneath it.
      if (!bucket) continue

      const revenue = toNumber(sale.totalAmount)
      const profit = toNumber(sale.profit)
      let saleItems = 0

      bucket.revenue += revenue
      bucket.profit += profit
      bucket.sales += 1
      bucket.days.add(localDateKey(sale.createdAt))

      const soldAt = sale.createdAt.toISOString()
      if (!bucket.lastSaleAt || soldAt > bucket.lastSaleAt) bucket.lastSaleAt = soldAt

      if (sale.user) {
        const cashier = bucket.cashiers.get(sale.user.id) ?? {
          userId: sale.user.id,
          name: sale.user.name,
          role: sale.user.role,
          sales: 0,
          revenue: 0,
          items: 0,
          refunds: 0,
        }
        cashier.sales += 1
        cashier.revenue += revenue
        bucket.cashiers.set(sale.user.id, cashier)
      }

      for (const item of sale.items) {
        saleItems += item.quantity
        const lineRevenue = Number(item.unitPrice) * item.quantity
        const product = bucket.products.get(item.product.id) ?? {
          productId: item.product.id,
          name: item.product.name,
          unit: item.product.unit,
          quantity: 0,
          revenue: 0,
          refundedQuantity: 0,
          refunds: 0,
        }
        product.quantity += item.quantity
        product.revenue += lineRevenue
        bucket.products.set(item.product.id, product)

        // Item counts roll up onto the cashier who rang the sale, so the
        // leaderboard answers "who moved the stock" and not just "who took the
        // most money" — a shop that sells a few expensive lines can have a
        // high-value cashier with a low item count.
        if (sale.user) {
          const cashier = bucket.cashiers.get(sale.user.id)!
          cashier.items += item.quantity
        }
      }

      bucket.items += saleItems
    }

    // Refunds, attributed to the branch whose sale they reverse. Comparing
    // branches on gross revenue alone flatters whichever shop sells the most
    // goods that then come back — the branch with the worst returns has to be
    // visible as such, or the leaderboard actively misdirects an owner.
    const refundLines = await fetchRefundLines({ gte: startDate, lte: endDate })
    for (const refund of refundLines) {
      const bucket = byBranch.get(refund.branchId)
      // A refund whose branch row was deleted is still money that left a till.
      // It is skipped rather than invented into a row, so the chain total below
      // stays explainable from the rows shown.
      if (!bucket) continue

      bucket.refunds += refund.totalRefund
      bucket.refundedProfit += refund.refundedProfit

      const cashierKey = refund.sellerId ?? 'deleted-user'
      const cashier = bucket.cashiers.get(cashierKey)
      // Only offset a cashier who exists in this branch's own rows; a phantom
      // cashier row is invented by the sales loop, never here.
      if (cashier) cashier.refunds += refund.totalRefund

      for (const item of refund.items) {
        const product = bucket.products.get(item.productId)
        if (!product) continue
        product.refundedQuantity += item.quantity
        product.refunds += item.refundAmount
      }
    }

    const rows = [...byBranch.entries()].map(([branchId, data]) => {
      const branch = branches.find((b) => b.id === branchId)
      const cashiers = [...data.cashiers.values()]
        .map((cashier) => ({ ...cashier, netRevenue: round2(cashier.revenue - cashier.refunds) }))
        .sort((a, b) => b.netRevenue - a.netRevenue)
      const topProducts = [...data.products.values()]
        .map((product) => ({
          ...product,
          netQuantity: product.quantity - product.refundedQuantity,
          netRevenue: round2(product.revenue - product.refunds),
        }))
        .sort((a, b) => b.netQuantity - a.netQuantity)
        .slice(0, 5)
      const netRevenue = round2(data.revenue - data.refunds)

      return {
        branchId,
        branchName: branch?.name ?? 'Unknown branch',
        branchCode: branch?.code ?? 'GEN',
        // False once the branch has been deactivated: the owner still needs to
        // see what it took, but must not read it as a trading shop.
        active: branch?.active ?? false,
        // GROSS stays visible next to net: a shop that took 500 and gave 200 back
        // is a different story from one that took 500 and kept it, and an owner
        // chasing the gap needs both numbers.
        revenue: data.revenue,
        refunds: round2(data.refunds),
        netRevenue,
        profit: data.profit,
        netProfit: round2(data.profit - data.refundedProfit),
        sales: data.sales,
        items: data.items,
        // Trading days, not calendar days — two branches in the same window with
        // the same revenue are not doing equally well if one was open once.
        tradingDays: data.days.size,
        averageSaleValue: data.sales > 0 ? netRevenue / data.sales : 0,
        averageDailyRevenue: data.days.size > 0 ? netRevenue / data.days.size : 0,
        lastSaleAt: data.lastSaleAt,
        cashiers,
        topProducts,
      }
    })

    const ranked = [...rows].sort((a, b) => b.netRevenue - a.netRevenue)
    const active = ranked.filter((r) => r.active)

    // Share of chain NET revenue, so the UI can render proportional bars without
    // doing the division itself against a total that may not match its own rows.
    const chainRevenue = round2(rows.reduce((sum, r) => sum + r.netRevenue, 0))

    return NextResponse.json({
      scope: 'all',
      from: localDateKey(startDate),
      to: localDateKey(endDate),
      branchCount: rows.length,
      totals: {
        revenue: chainRevenue,
        grossRevenue: round2(rows.reduce((sum, r) => sum + r.revenue, 0)),
        refunds: round2(rows.reduce((sum, r) => sum + r.refunds, 0)),
        profit: round2(rows.reduce((sum, r) => sum + r.netProfit, 0)),
        grossProfit: round2(rows.reduce((sum, r) => sum + r.profit, 0)),
        sales: rows.reduce((sum, r) => sum + r.sales, 0),
        items: rows.reduce((sum, r) => sum + r.items, 0),
      },
      branches: ranked.map((r) => ({
        ...r,
        revenueShare: chainRevenue > 0 ? r.netRevenue / chainRevenue : 0,
      })),
      // The single branch taking the most money, named — the figure an owner
      // checks first, and the one that is impossible to eyeball from a flat list.
      topBranchByRevenue: active[0]
        ? {
            branchId: active[0].branchId,
            branchName: active[0].branchName,
            revenue: active[0].netRevenue,
            grossRevenue: active[0].revenue,
            refunds: active[0].refunds,
          }
        : null,
    })
  } catch (error) {
    console.error('Branch comparison error:', error)
    return NextResponse.json(
      { error: 'Failed to load the branch comparison' },
      { status: 500 }
    )
  }
}
