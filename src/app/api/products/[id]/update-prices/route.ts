import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'

/**
 * PUT /api/products/[id]/update-prices
 * Update a product's prices and propagate them to the batches that sell it.
 *
 * Body:
 *   defaultCostPrice: number
 *   defaultSellingPrice: number
 *   applyToBatches: boolean      (default TRUE)  - also revalue the batches
 *   batchScope: 'all' | 'branch' (default 'all') - which branches to revalue
 *
 * WHY PRICES PROPAGATE ACROSS BRANCHES BY DEFAULT
 *
 * The till charges `min(batch.sellingPrice)`, NOT `product.defaultSellingPrice`.
 * So a product edit that only touched the product row changed nothing a
 * customer could actually be charged — the owner would set a new price, watch
 * the catalogue screen show it, and the tills at every branch would keep
 * charging the old number. That is the "admin updates do not reach the branches"
 * bug, and the only way a catalogue price is real is if it reaches the batches
 * that the POS reads. The same reasoning applies to stock the owner adds later:
 * a fresh quantity-0 batch inherits the catalogue price, so the propagation here
 * and the seed prices there have to agree.
 *
 * Global is therefore the default, matching the owner's requirement that an
 * admin's change be reflected at every branch straight away. `batchScope:
 * 'branch'` remains for the deliberate case where one shop alone is changing its
 * cost basis (a local supplier, a clearance) and must not rewrite another
 * branch's numbers.
 *
 * Historical accuracy is not at risk: `SaleItem` snapshots `unitPrice` and
 * `costPrice` at the moment of sale, so revaluing a batch never rewrites what a
 * past sale actually charged or what margin it reported.
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

    const {
      defaultCostPrice,
      defaultSellingPrice,
      // Defaults flipped to propagate: an edit that does not reach the tills is
      // not a price change, it is a lie on the catalogue screen.
      applyToBatches = true,
      batchScope = 'all',
    } = body

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

    if (batchScope !== 'all' && batchScope !== 'branch') {
      return NextResponse.json(
        { error: "batchScope must be 'all' or 'branch'" },
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
    // 'all' deliberately ignores the admin's selected branch: a catalogue price
    // is shared, and requiring the owner to be parked on "All branches" to make
    // a price real is how branches end up permanently out of step.
    const targetBranchId = batchScope === 'branch' ? scope.branchId : null
    if (batchScope === 'branch' && !targetBranchId) {
      return NextResponse.json(
        { error: 'Select a specific branch to revalue only that branch, or apply to all branches' },
        { status: 400 }
      )
    }

    const batchFilter = targetBranchId
      ? { productId: id, branchId: targetBranchId }
      : { productId: id }

    const result = await db.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: {
          defaultCostPrice,
          defaultSellingPrice,
        },
        include: {
          category: { select: { id: true, name: true } },
          // Show the batches the propagation is about to touch, so the admin can
          // see the blast radius. When revaluing everything, name the branches
          // involved rather than dumping another shop's rows unlabelled.
          batches: {
            where: batchFilter,
            include: { branch: { select: { id: true, name: true, code: true } } },
            orderBy: { createdAt: 'desc' },
          },
        },
      })

      let batchesUpdated = 0
      if (applyToBatches) {
        const res = await tx.batch.updateMany({
          where: batchFilter,
          data: {
            costPrice: defaultCostPrice,
            sellingPrice: defaultSellingPrice,
          },
        })
        batchesUpdated = res.count
      }

      return { updated, batchesUpdated }
    })

    const scopeLabel =
      batchScope === 'branch' ? 'in this branch' : 'across ALL branches'

    await logAudit({
      userId: auth.user!.userId,
      action: 'UPDATE',
      entity: 'Product',
      entityId: id,
      details: `Updated prices for "${product.name}"${result.batchesUpdated > 0 ? ` (applied to ${result.batchesUpdated} batch${result.batchesUpdated !== 1 ? 'es' : ''} ${scopeLabel})` : ''}`,
      branchId: scope.branchId,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({
      product: result.updated,
      batchesUpdated: result.batchesUpdated,
      batchScope,
      message: result.batchesUpdated > 0
        ? `Prices updated for product and ${result.batchesUpdated} batch${result.batchesUpdated !== 1 ? 'es' : ''} ${scopeLabel}`
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
