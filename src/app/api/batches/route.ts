import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, requireAdmin } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'

/** Generates a unique, human-friendly batch number for a product. */
async function generateBatchNumber(db: any, productId: string): Promise<string> {
  const existing = await db.batch.findMany({
    where: { productId },
    select: { batchNumber: true },
  })
  const base = `BATCH-${String(existing.length + 1).padStart(3, '0')}`
  const taken = new Set(existing.map((b: { batchNumber: string }) => b.batchNumber))
  if (!taken.has(base)) return base
  let n = existing.length + 2
  while (taken.has(`BATCH-${String(n).padStart(3, '0')}`)) n += 1
  return `BATCH-${String(n).padStart(3, '0')}`
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('productId') || ''
    const expiringSoon = searchParams.get('expiringSoon') === 'true'

    const now = new Date()
    const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

    let where: Record<string, unknown> = {}

    if (productId) {
      where.productId = productId
    }

    if (expiringSoon) {
      where.expiryDate = { lte: ninetyDaysFromNow }
      where.quantity = { gt: 0 }
    }

    const batches = await db.batch.findMany({
      where,
      include: {
        product: {
          select: { id: true, name: true, unit: true, reorderLevel: true },
        },
        purchase: {
          select: { id: true, invoiceNo: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(batches.map((b) => ({
      ...b,
      quantity: Number(b.quantity),
      costPrice: Number(b.costPrice),
      sellingPrice: Number(b.sellingPrice),
    })))
  } catch (error) {
    console.error('Batches list error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch batches' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/batches — create a new stock batch for a product.
 * Admin only. Body: { productId, batchNumber, quantity, costPrice, sellingPrice, expiryDate }
 *
 * batchNumber and expiryDate are OPTIONAL — they must never block adding stock.
 * When omitted: a unique batch number is generated automatically and the expiry
 * defaults to +24 months from today.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await request.json()
    const { productId } = body

    if (!productId) {
      return NextResponse.json({ error: 'productId is required' }, { status: 400 })
    }

    const product = await db.product.findUnique({ where: { id: productId } })
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const quantity = Math.max(0, Number(body.quantity ?? 0) || 0)
    const costPrice = Math.max(0, Number(body.costPrice ?? 0) || 0)
    const sellingPrice = Math.max(0, Number(body.sellingPrice ?? 0) || 0)

    // Expiry: optional — default to +24 months when not supplied or empty.
    let expiryDate = new Date()
    expiryDate.setMonth(expiryDate.getMonth() + 24)
    if (typeof body.expiryDate === 'string' && body.expiryDate.trim()) {
      const parsed = new Date(body.expiryDate)
      if (isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: 'Invalid expiryDate (expected YYYY-MM-DD)' },
          { status: 400 }
        )
      }
      expiryDate = parsed
    }

    // Batch number: optional — generate a unique one automatically when blank
    // so an empty field never blocks adding inventory.
    const rawBatchNumber =
      typeof body.batchNumber === 'string' && body.batchNumber.trim()
        ? body.batchNumber.trim()
        : (await generateBatchNumber(db, productId))

    const existing = await db.batch.findFirst({
      where: { productId, batchNumber: rawBatchNumber },
    })
    if (existing) {
      return NextResponse.json(
        { error: `Batch "${rawBatchNumber}" already exists for this product` },
        { status: 409 }
      )
    }

    const batch = await db.batch.create({
      data: {
        productId,
        batchNumber: rawBatchNumber,
        quantity,
        costPrice,
        sellingPrice,
        expiryDate,
      },
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'CREATE',
      entity: 'Batch',
      entityId: batch.id,
      details: `Created batch "${batch.batchNumber}" (qty: ${batch.quantity}) for "${product.name}"`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(batch, { status: 201 })
  } catch (error) {
    console.error('Batch create error:', error)
    return NextResponse.json({ error: 'Failed to create batch' }, { status: 500 })
  }
}
