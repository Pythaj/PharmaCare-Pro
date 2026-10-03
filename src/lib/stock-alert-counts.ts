/**
 * Low-stock / expiry alert counts.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * The header badge in `Header.tsx` needs exactly two integers and polls them
 * every 60 seconds from EVERY page. It was calling `/api/dashboard/stats` to get
 * them, which is the full dashboard: six Sale aggregates, four refund-money
 * aggregations, every in-stock batch pulled into memory to value the shelf, and a
 * per-product groupBy — all to render a number in a bell.
 *
 * That is wasteful everywhere, and on the admin dashboard it is also duplicated:
 * `AdminDashboard` already polls the same endpoint every 30 seconds for the tiles,
 * so the endpoint ran three times a minute and one of those results was thrown
 * away after two fields were read.
 *
 * Giving the badge its own endpoint fixes the duplication, but two copies of the
 * same rule is a worse problem than the one being solved: the file this was
 * extracted from already carries a warning about exactly that (`classifyStock` was
 * duplicated once and the inventory screen and the dashboard tile drifted apart).
 * So the rule lives here once and both callers use it.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { classifyStock } from '@/lib/inventory-alerts'
import {
  createEffectiveValueResolver,
  loadBranchProductOverrides,
} from '@/lib/branch-product-settings'

export type AlertCounts = {
  lowStockCount: number
  expiringCount: number
  expiredCount: number
  /** Active products holding at least one unit. Free — same groupBy. */
  productsInStock: number
}

/**
 * Counts products that need reordering and batches that need attention.
 *
 * @param stockWhere  The already-resolved batch boundary — `branchWhere(scope)`,
 *                    so stock figures respect the selected branch exactly as the
 *                    rest of the dashboard does. Passed in rather than derived
 *                    here so this module has no opinion about scope.
 * @param branchId    The selected branch, for per-branch reorder thresholds. Pass
 *                    `null` on the consolidated view, where every product falls
 *                    back to its chain-wide `Product.reorderLevel` — the honest
 *                    answer when there is no single branch to answer for.
 * @param expiryHorizon  `now` plus the configured alert window, so the header
 *                    badge and the dashboard tile warn about the same batches
 *                    rather than two different windows.
 */
export async function computeAlertCounts(
  db: PrismaClient,
  params: {
    stockWhere: Prisma.BatchWhereInput
    branchId: string | null
    expiryHorizon: Date
    now: Date
  }
): Promise<AlertCounts> {
  const { stockWhere, branchId, expiryHorizon, now } = params

  const resolveValues = createEffectiveValueResolver(
    await loadBranchProductOverrides(branchId)
  )

  const [productRows, stockByProduct, expiringCount, expiredCount] = await Promise.all([
    // Two columns only — this used to pull every Product field for every product.
    db.product.findMany({
      where: { active: true },
      select: { id: true, reorderLevel: true },
    }),
    // Aggregate in SQL instead of loading every batch row into memory and folding
    // it per product in JS.
    db.batch.groupBy({
      by: ['productId'],
      where: { ...stockWhere, quantity: { gt: 0 } },
      _sum: { quantity: true },
    }),
    // Expiring soon: inside the configured window and NOT already expired.
    db.batch.count({
      where: {
        ...stockWhere,
        quantity: { gt: 0 },
        expiryDate: { gt: now, lte: expiryHorizon },
      },
    }),
    // Expired: its own count, instead of being lumped in with "expiring".
    db.batch.count({
      where: { ...stockWhere, quantity: { gt: 0 }, expiryDate: { lte: now } },
    }),
  ])

  const stockByProductId = new Map(
    stockByProduct.map((row) => [row.productId, row._sum.quantity ?? 0])
  )

  let lowStockCount = 0
  let productsInStock = 0
  for (const product of productRows) {
    const stock = stockByProductId.get(product.id) ?? 0
    if (stock > 0) productsInStock += 1
    // The shared classifier, not an inline copy of the rule. Zero stock is
    // deliberately not "low" — it has its own figure.
    if (classifyStock(stock, resolveValues(product).reorderLevel) === 'low_stock') {
      lowStockCount += 1
    }
  }

  return { lowStockCount, expiringCount, expiredCount, productsInStock }
}