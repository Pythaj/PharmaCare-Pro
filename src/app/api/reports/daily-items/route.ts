import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/require-auth'
import { toNumber } from '@/lib/utils'
import { localDateKey } from '@/lib/dates'

/**
 * GET /api/reports/daily-items
 *
 * "What was sold, by which item, on which day, at which branch, by whom" — the
 * reconciliation view. The daily register totals answer "how much did we take";
 * this answers "of that, exactly which items left the shelf, in which branch, and
 * who rang them".
 *
 * ## Why the drilldown is separate from /api/reports
 *
 * The existing reports route aggregates whole sales, so its `topProducts` is a
 * ranking over a window with no per-day, per-branch or per-cashier breakdown. An
 * owner reconciling a day's till needs the leaf rows, and adding them there would
 * mean every reports request drags along a full day-by-day-by-product join that
 * the summary view never reads.
 *
 * ## Scope
 *
 * `requireAdmin`, spanning the business, same as /api/reports/branches and for
 * the same reason: reconciliation is inherently a cross-branch read. It is
 * strictly read-only, and the branch-scoped mutation routes keep their
 * "select a branch first" refusals.
 *
 * `date` is a local calendar day (YYYY-MM-DD). `branchId` narrows to one shop
 * when the owner wants to reconcile a single till.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(request.url)
    const dateStr = searchParams.get('date')
    const branchId = searchParams.get('branchId')

    const today = new Date()
    // Default to today, in LOCAL terms. Falling back to `toISOString()` here
    // would pick the wrong day for any shop whose clock is behind UTC — the
    // request arriving at 08:00 in Accra is still "yesterday" in UTC, and the
    // report would open on an empty day.
    const key =
      dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : localDateKey(today)

    const [year, month, day] = key.split('-').map(Number)
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }

    const start = new Date(year, month - 1, day)
    const end = new Date(year, month - 1, day, 23, 59, 59, 999)

    if (branchId) {
      const branch = await db.branch.findUnique({
        where: { id: branchId },
        select: { id: true },
      })
      if (!branch) {
        return NextResponse.json({ error: 'Branch not found' }, { status: 404 })
      }
    }

    const sales = await db.sale.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        status: 'completed',
        ...(branchId ? { branchId } : {}),
      },
      select: {
        id: true,
        invoiceNo: true,
        branchId: true,
        branch: { select: { name: true, code: true } },
        user: { select: { id: true, name: true, role: true } },
        totalAmount: true,
        profit: true,
        createdAt: true,
        items: {
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            costPrice: true,
            product: { select: { id: true, name: true, unit: true } },
            batch: { select: { id: true, batchNumber: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    interface ItemRow {
      productId: string
      name: string
      unit: string
      quantity: number
      revenue: number
      profit: number
      /** Distinct batches this item left the shelf in — a spike in here is the
       *  signature of one batch being opened, not of demand changing. */
      batches: string[]
      sales: number
    }

    const byProduct = new Map<string, ItemRow>()
    const byBranch = new Map<string, {
      branchId: string
      branchName: string
      branchCode: string
      revenue: number
      profit: number
      items: number
      sales: number
    }>()

    let revenue = 0
    let profit = 0
    let itemCount = 0

    for (const sale of sales) {
      const saleRevenue = toNumber(sale.totalAmount)
      const saleProfit = toNumber(sale.profit)
      revenue += saleRevenue
      profit += saleProfit

      const branchBucket = byBranch.get(sale.branchId) ?? {
        branchId: sale.branchId,
        branchName: sale.branch?.name ?? 'Unknown branch',
        branchCode: sale.branch?.code ?? 'GEN',
        revenue: 0,
        profit: 0,
        items: 0,
        sales: 0,
      }
      branchBucket.revenue += saleRevenue
      branchBucket.profit += saleProfit
      branchBucket.sales += 1
      byBranch.set(sale.branchId, branchBucket)

      for (const item of sale.items) {
        itemCount += item.quantity
        branchBucket.items += item.quantity

        const row = byProduct.get(item.product.id) ?? {
          productId: item.product.id,
          name: item.product.name,
          unit: item.product.unit,
          quantity: 0,
          revenue: 0,
          profit: 0,
          batches: [],
          sales: 0,
        }
        row.quantity += item.quantity
        row.revenue += item.unitPrice * item.quantity
        // Exact, not an allocation: `POST /api/sales` computes the sale's profit
        // as `sum((unitPrice - costPrice) * quantity)` from the batch it actually
        // drew from, so summing this column reproduces `sale.profit` exactly. The
        // lines are summed at the same precision they were sold at, so the item
        // column always reconciles to the day's recorded profit.
        row.profit += (item.unitPrice - item.costPrice) * item.quantity
        row.sales += 1
        if (item.batch && !row.batches.includes(item.batch.batchNumber)) {
          row.batches.push(item.batch.batchNumber)
        }
        byProduct.set(item.product.id, row)
      }
    }

    const items = [...byProduct.values()].sort(
      (a, b) => b.quantity - a.quantity || b.revenue - a.revenue
    )

    return NextResponse.json({
      scope: branchId ? 'branch' : 'all',
      date: key,
      branchId: branchId ?? null,
      summary: {
        sales: sales.length,
        revenue,
        profit,
        items: itemCount,
        // Distinct products, so "we sold 400 units" and "we sold 12 lines" are
        // never presented as the same figure.
        distinctProducts: items.length,
        averageSaleValue: sales.length > 0 ? revenue / sales.length : 0,
      },
      // Every branch that traded that day, so the owner can see the day's takings
      // split without a second request.
      byBranch: [...byBranch.values()].sort((a, b) => b.revenue - a.revenue),
      items,
    })
  } catch (error) {
    console.error('Daily items error:', error)
    return NextResponse.json(
      { error: 'Failed to load the day\u2019s item sales' },
      { status: 500 }
    )
  }
}
