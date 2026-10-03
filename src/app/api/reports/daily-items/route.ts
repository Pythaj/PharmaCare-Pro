import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/require-auth'
import { toNumber } from '@/lib/utils'
import { localDateKey } from '@/lib/dates'
import { aggregateRefundsByProduct, fetchRefundLines } from '@/lib/refunds'
import { isUnknownSalesperson } from '@/lib/salesperson'

const round2 = (n: number) => Math.round(n * 100) / 100

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
 * when the owner wants to reconcile a single till. `userId` narrows to one
 * salesperson's till across whichever branches they rang up at.
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
    // Which salesperson's till to reconcile. Applied at the SALE, not after the
    // fact, so every derived figure below — item totals, profit, invoice list and
    // refunds — is scoped to the same person. Filtering the already-aggregated
    // rows instead would leave the summary, the branch split and the invoice list
    // describing three different days.
    const userId = searchParams.get('userId')
    // `unknown` is a request for sales with no user attached (the User row was
    // deleted), not a lookup key — resolving it as a user id found nothing and
    // 404'd the one grouping the report must be able to open. `undefined` means
    // no salesperson filter; `null` means "userId IS NULL".
    const unknownSalesperson = isUnknownSalesperson(userId)
    const salespersonFilter: string | null | undefined = unknownSalesperson
      ? null
      : userId ?? undefined

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

    if (userId && !unknownSalesperson) {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true },
      })
      if (!user) {
        return NextResponse.json({ error: 'Salesperson not found' }, { status: 404 })
      }
    }

    const sales = await db.sale.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        status: 'completed',
        ...(branchId ? { branchId } : {}),
        ...(salespersonFilter !== undefined ? { userId: salespersonFilter } : {}),
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
      refundedQuantity: number
      refunds: number
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
      refunds: number
      refundedProfit: number
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
        refunds: 0,
        refundedProfit: 0,
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
          refundedQuantity: 0,
          refunds: 0,
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

    // Refunds processed on this local day, for the same shops and the same
    // salesperson. A reconciliation that counts only what went out is not a
    // reconciliation: the drawer, the shelf and the day all net, so this view has
    // to as well. The `branchId` filter is applied to the SALE the refund belongs
    // to, matching how the sales above were selected — a refund is not "at a
    // branch", it is against a receipt that was rung up at one. The same holds
    // for `userId`: the money is given back against *their* receipt, even if a
    // different member of staff processed the return at the counter. Attributing
    // it to whoever clicked approve instead would let a day's refunds shift
    // between salespeople depending on who was on the desk, which is precisely
    // the number this report exists to pin down.
    const refundLines = await fetchRefundLines(
      { gte: start, lte: end },
      {
        ...(branchId ? { branchId } : {}),
        ...(salespersonFilter !== undefined ? { userId: salespersonFilter } : {}),
      }
    )
    const totalRefunds = refundLines.reduce((sum, refund) => sum + refund.totalRefund, 0)
    const refundedProfit = refundLines.reduce((sum, refund) => sum + refund.refundedProfit, 0)

    // Returned quantity per receipt line, so the invoice list below can show what
    // came back against each line rather than only a day-level total.
    const returnedBySaleItem = new Map<string, { quantity: number; amount: number }>()
    const refundsBySale = new Map<string, number>()

    for (const refund of refundLines) {
      refundsBySale.set(
        refund.saleId,
        round2((refundsBySale.get(refund.saleId) ?? 0) + refund.totalRefund)
      )
      for (const item of refund.items) {
        const existing = returnedBySaleItem.get(item.saleItemId) ?? { quantity: 0, amount: 0 }
        existing.quantity += item.quantity
        existing.amount += item.refundAmount
        returnedBySaleItem.set(item.saleItemId, existing)
      }
    }

    const refundsByProduct = aggregateRefundsByProduct(refundLines)
    const refundedOnlyProductIds: string[] = []
    for (const [productId, totals] of refundsByProduct) {
      const row = byProduct.get(productId)
      // Nothing sold today but something came back today is a real day, and the
      // refund total above has to be explainable by the lines below it. Dropping
      // these products would leave the day's refund money with nowhere to land.
      if (!row) {
        refundedOnlyProductIds.push(productId)
        continue
      }
      row.refundedQuantity += totals.quantity
      row.refunds += totals.refundAmount
    }

    if (refundedOnlyProductIds.length > 0) {
      const returnedProducts = await db.product.findMany({
        where: { id: { in: refundedOnlyProductIds } },
        select: { id: true, name: true, unit: true },
      })
      const productNames = new Map(returnedProducts.map((p) => [p.id, p]))
      for (const productId of refundedOnlyProductIds) {
        const product = productNames.get(productId)
        const totals = refundsByProduct.get(productId)!
        byProduct.set(productId, {
          productId,
          name: product?.name ?? 'Unknown product',
          unit: product?.unit ?? '',
          quantity: 0,
          revenue: 0,
          profit: 0,
          batches: [],
          sales: 0,
          refundedQuantity: totals.quantity,
          refunds: totals.refundAmount,
        })
      }
    }

    // Per-branch refunds. A shop can have a refund today with no sale today —
    // someone bringing back yesterday's purchase — so the split has to survive a
    // branch that never appears in the sales loop.
    const refundByBranch = new Map<string, { refunds: number; profit: number }>()
    for (const refund of refundLines) {
      const totals = refundByBranch.get(refund.branchId) ?? { refunds: 0, profit: 0 }
      totals.refunds += refund.totalRefund
      totals.profit += refund.refundedProfit
      refundByBranch.set(refund.branchId, totals)
    }

    /* Per-salesperson split, mirroring `byBranch`.
     *
     * The report could only ever break a day down by SHOP, so an owner asking
     * "who sold this" had no answer and had to read every invoice row. Two staff
     * can share a till, cover each other's breaks, and ring up at two different
     * branches in one shift; the branch split cannot distinguish them and the
     * consolidated "All branches" view cannot either. This buckets the same day
     * by the person who rang it up.
     *
     * Refunds land in the bucket of the SELLER of the refunded sale
     * (`RefundLine.sellerId`), not the operator who approved the return, so a
     * till is not credited or charged for someone else's till. */
    const bySalesperson = new Map<string, {
      userId: string | null
      name: string
      role: string | null
      revenue: number
      profit: number
      items: number
      sales: number
      refunds: number
      refundedProfit: number
      branches: Set<string>
    }>()

    for (const sale of sales) {
      const id = sale.user?.id ?? null
      const bucket = bySalesperson.get(id ?? 'none') ?? {
        userId: id,
        name: sale.user?.name ?? 'Unknown salesperson',
        role: sale.user?.role ?? null,
        revenue: 0,
        profit: 0,
        items: 0,
        sales: 0,
        refunds: 0,
        refundedProfit: 0,
        branches: new Set<string>(),
      }
      bucket.revenue += toNumber(sale.totalAmount)
      bucket.profit += toNumber(sale.profit)
      bucket.sales += 1
      bucket.branches.add(sale.branchId)
      for (const item of sale.items) {
        bucket.items += item.quantity
      }
      bySalesperson.set(id ?? 'none', bucket)
    }

    for (const refund of refundLines) {
      /* A refund whose original seller sold nothing else that day still belongs
         in the column — their takings genuinely were that much lower. Skipping it
         would show a salesperson with a clean sheet who is actually short, which
         is the exact accusation this report should never make. */
      const key = refund.sellerId ?? 'none';
      let bucket = bySalesperson.get(key);
      if (!bucket) {
        bucket = {
          userId: refund.sellerId,
          name: 'Unknown salesperson',
          role: null,
          revenue: 0,
          profit: 0,
          items: 0,
          sales: 0,
          refunds: 0,
          refundedProfit: 0,
          branches: new Set<string>(),
        };
        bySalesperson.set(key, bucket);
      }
      /* Added unconditionally, including on the bucket just created above. An
         earlier version `continue`d after seeding an empty bucket, which dropped
         the very refunds it existed to show — the seller would appear with zero
         sales AND zero refunds on a day that returned their money. */
      bucket.refunds += refund.totalRefund
      bucket.refundedProfit += refund.refundedProfit
      bucket.branches.add(refund.branchId)
    }

    const orphanBranchIds = [...refundByBranch.keys()].filter((id) => !byBranch.has(id))
    if (orphanBranchIds.length > 0) {
      const orphanBranches = await db.branch.findMany({
        where: { id: { in: orphanBranchIds } },
        select: { id: true, name: true, code: true },
      })
      const branchNames = new Map(orphanBranches.map((b) => [b.id, b]))
      for (const id of orphanBranchIds) {
        const branch = branchNames.get(id)
        byBranch.set(id, {
          branchId: id,
          branchName: branch?.name ?? 'Unknown branch',
          branchCode: branch?.code ?? 'GEN',
          revenue: 0,
          profit: 0,
          items: 0,
          sales: 0,
          refunds: 0,
          refundedProfit: 0,
        })
      }
    }

    for (const [id, totals] of refundByBranch) {
      const bucket = byBranch.get(id)
      if (!bucket) continue
      bucket.refunds += totals.refunds
      bucket.refundedProfit += totals.profit
    }

    const items = [...byProduct.values()]
      .map((row) => ({
        ...row,
        refunds: round2(row.refunds),
        // Ranked on what is still out there. "Sold 400, returned 380" appearing
        // as the day's top line item is the single most misleading thing this
        // report could show an owner reconciling a shelf.
        netQuantity: row.quantity - row.refundedQuantity,
        netRevenue: round2(row.revenue - row.refunds),
      }))
      .sort((a, b) => b.netQuantity - a.netQuantity || b.revenue - a.revenue)

    // The invoice-level book for the day. `invoiceNo` was already selected above
    // and then dropped on the floor, which is why the only drilldown this report
    // offered was "which product", never "which receipt": an owner asking to see
    // the individual items sold on a given day at a given branch could reconcile
    // a total but never read the sale behind it. Each row is one receipt, with
    // the branch and cashier it belongs to, and its full line-item detail.
    const invoices = sales.map((sale) => ({
      id: sale.id,
      invoiceNo: sale.invoiceNo,
      branchId: sale.branchId,
      branchName: sale.branch?.name ?? 'Unknown branch',
      branchCode: sale.branch?.code ?? 'GEN',
      cashierId: sale.user?.id ?? null,
      cashierName: sale.user?.name ?? 'Unknown cashier',
      totalAmount: toNumber(sale.totalAmount),
      profit: toNumber(sale.profit),
      // What was handed back against THIS receipt. Nil when nothing was, so the
      // UI can leave the line unmarked instead of printing a column of zeros.
      refundedAmount: refundsBySale.get(sale.id) ?? 0,
      netAmount: round2(toNumber(sale.totalAmount) - (refundsBySale.get(sale.id) ?? 0)),
      createdAt: sale.createdAt,
      itemCount: sale.items.reduce((sum: number, i: any) => sum + Number(i.quantity), 0),
      items: sale.items.map((item: any) => {
        const returned = returnedBySaleItem.get(item.id)
        return {
          id: item.id,
          productId: item.product.id,
          productName: item.product.name,
          unit: item.product.unit,
          batchNumber: item.batch?.batchNumber ?? null,
          quantity: Number(item.quantity),
          // Per line, this is what the individual item sold for and what came
          // back for it — the level a cashier is reconciling at the counter.
          returnedQuantity: returned?.quantity ?? 0,
          refundAmount: round2(returned?.amount ?? 0),
          netQuantity: Number(item.quantity) - (returned?.quantity ?? 0),
          unitPrice: toNumber(item.unitPrice),
          costPrice: toNumber(item.costPrice),
          total: toNumber(item.unitPrice) * Number(item.quantity),
        }
      }),
    }))

    return NextResponse.json({
      scope: branchId ? 'branch' : 'all',
      date: key,
      branchId: branchId ?? null,
      // Echoed so the UI can label what it is looking at without keeping its own
      // copy of the request state, and so a filter that was silently dropped is
      // visible rather than showing a whole-business total under a single-till
      // heading.
      userId: userId ?? null,
      summary: {
        sales: sales.length,
        // Net headline, with gross beside it. The drawer counted cash out as well
        // as in, so a day figure that ignored refunds never matched the till.
        revenue: round2(revenue - totalRefunds),
        grossRevenue: round2(revenue),
        refunds: round2(totalRefunds),
        refundCount: refundLines.length,
        profit: round2(profit - refundedProfit),
        grossProfit: round2(profit),
        items: itemCount,
        // Distinct products, so "we sold 400 units" and "we sold 12 lines" are
        // never presented as the same figure.
        distinctProducts: items.length,
        averageSaleValue: sales.length > 0 ? round2((revenue - totalRefunds) / sales.length) : 0,
      },
      // Every branch that traded that day, so the owner can see the day's takings
      // split without a second request. A branch that only processed a refund
      // still appears, with zero sales — which is exactly the day worth
      // explaining.
      byBranch: [...byBranch.values()]
        .map((bucket) => ({
          ...bucket,
          refunds: round2(bucket.refunds),
          netRevenue: round2(bucket.revenue - bucket.refunds),
          netProfit: round2(bucket.profit - bucket.refundedProfit),
        }))
        .sort((a, b) => b.netRevenue - a.netRevenue),
      // Newest first, matching the register the owner is reconciling against.
      invoices: invoices.reverse(),
      items,
      // Same day, same money, grouped by whose till it was. `branches` is a set
      // serialised to an array — one person working two shops in a shift is a
      // thing the owner needs to see, not a rounding error to hide.
      bySalesperson: [...bySalesperson.values()]
        .map((bucket) => ({
          userId: bucket.userId,
          name: bucket.name,
          role: bucket.role,
          revenue: round2(bucket.revenue),
          profit: round2(bucket.profit),
          items: bucket.items,
          sales: bucket.sales,
          refunds: round2(bucket.refunds),
          refundedProfit: round2(bucket.refundedProfit),
          netRevenue: round2(bucket.revenue - bucket.refunds),
          netProfit: round2(bucket.profit - bucket.refundedProfit),
          branches: [...bucket.branches],
        }))
        .sort((a, b) => b.netRevenue - a.netRevenue),
    })
  } catch (error) {
    console.error('Daily items error:', error)
    return NextResponse.json(
      { error: 'Failed to load the day\u2019s item sales' },
      { status: 500 }
    )
  }
}
