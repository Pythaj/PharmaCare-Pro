import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/require-admin'

/**
 * PUT /api/products/[id]/update-prices
 * Update a product's default prices AND optionally all its batch prices.
 *
 * Body:
 *   defaultCostPrice: number
 *   defaultSellingPrice: number
 *   applyToBatches: boolean   (default false) — if true, also updates every batch's costPrice & sellingPrice
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const auth = await requireAdmin(body)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { defaultCostPrice, defaultSellingPrice, applyToBatches = false } = body

    if (defaultCostPrice === undefined || defaultSellingPrice === undefined) {
      return NextResponse.json(
        { error: 'defaultCostPrice and defaultSellingPrice are required' },
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

    // Update product default prices
    const updated = await db.product.update({
      where: { id },
      data: {
        defaultCostPrice,
        defaultSellingPrice,
      },
      include: {
        category: { select: { id: true, name: true } },
        batches: { orderBy: { createdAt: 'desc' } },
      },
    })

    // Optionally update all existing batches
    let batchesUpdated = 0
    if (applyToBatches) {
      const result = await db.batch.updateMany({
        where: { productId: id },
        data: {
          costPrice: defaultCostPrice,
          sellingPrice: defaultSellingPrice,
        },
      })
      batchesUpdated = result.count

      // Re-fetch with updated batches
      const refreshed = await db.product.findUnique({
        where: { id },
        include: {
          category: { select: { id: true, name: true } },
          batches: { orderBy: { createdAt: 'desc' } },
        },
      })

      return NextResponse.json({
        product: refreshed,
        batchesUpdated,
        message: batchesUpdated > 0
          ? `Prices updated for product and ${batchesUpdated} batch${batchesUpdated !== 1 ? 'es' : ''}`
          : 'Product prices updated (no batches to update)',
      })
    }

    return NextResponse.json({
      product: updated,
      batchesUpdated: 0,
      message: 'Product default prices updated',
    })
  } catch (error) {
    console.error('Price update error:', error)
    return NextResponse.json(
      { error: 'Failed to update prices' },
      { status: 500 }
    )
  }
}