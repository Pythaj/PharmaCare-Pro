import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { branchWhere } from '@/lib/branches'
import { logAudit, getClientIp } from '@/lib/audit'

/**
 * PUT /api/products/[id]/update-prices
 * Update a product's default prices AND optionally all its batch prices.
 *
 * Body:
 *   defaultCostPrice: number
 *   defaultSellingPrice: number
 *   applyToBatches: boolean   (default false) - if true, also updates every batch's costPrice & sellingPrice
 *
 * The product's own defaults are the SHARED catalogue, so they are global. A
 * batch's cost is not: it is one branch's stock at the price that branch paid.
 * Propagating a new price across every branch's existing batches from a single
 * branch's screen would rewrite another shop's cost basis — and, because past
 * sales' profit was measured against the old cost, would leave their reported
 * margins quietly wrong. So batch propagation follows the active branch, and
 * only the "All branches" view revalues the whole chain.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    // Auth from HttpOnly JWT cookie - identity is never trusted from the body
    const auth = await requireBranchScope(request, { admin: true })
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    const body = await request.json()

    const { defaultCostPrice, defaultSellingPrice, applyToBatches = false } = body

    if (typeof defaultCostPrice !== 'number' || typeof defaultSellingPrice !== 'number') {
      return NextResponse.json(
        { error: 'defaultCostPrice and defaultSellingPrice must be numbers' },
        { status: 400 }
      )
    }

    if (defaultCostPrice < 0 || defaultSellingPrice < 0) {
      return NextResponse.json(
        { error: 'Prices cannot be negative' },
        { status: 400 }
      )
    }

    const product = await db.product.findUnique({ where: { id } })
    if (!product) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      )
    }

    // Atomic: product defaults and batch propagation commit together (Rule 9/12)
    const scope = auth.scope!
    const isSingleBranch = !!scope.branchId
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: {
          defaultCostPrice,
          defaultSellingPrice,
        },
        include: {
          category: { select: { id: true, name: true } },
          // Only ever show this branch's batches, so the admin can see which rows
          // the propagation below is about to touch.
          batches: {
            where: branchWhere(scope),
            orderBy: { createdAt: 'desc' },
          },
        },
      })

      let batchesUpdated = 0
      if (applyToBatches) {
        const res = await tx.batch.updateMany({
          where: { productId: id, ...branchWhere(scope) },
          data: {
            costPrice: defaultCostPrice,
            sellingPrice: defaultSellingPrice,
          },
        })
        batchesUpdated = res.count
      }

      return { updated, batchesUpdated }
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'UPDATE',
      entity: 'Product',
      entityId: id,
      details: `Updated prices for "${product.name}"${result.batchesUpdated > 0 ? ` (applied to ${result.batchesUpdated} batch${result.batchesUpdated !== 1 ? 'es' : ''}${isSingleBranch ? ' in this branch' : ' across ALL branches'})` : ''}`,
      branchId: scope.branchId,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({
      product: result.updated,
      batchesUpdated: result.batchesUpdated,
      message: result.batchesUpdated > 0
        ? `Prices updated for product and ${result.batchesUpdated} batch${result.batchesUpdated !== 1 ? 'es' : ''}${isSingleBranch ? ' in this branch' : ''}`
        : 'Product default prices updated',
    })
  } catch (error) {
    console.error('Price update error:', error)
    return NextResponse.json(
      { error: 'Failed to update prices' },
      { status: 500 }
    )
  }
}
