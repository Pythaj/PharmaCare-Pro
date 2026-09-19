import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, requireAuth } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Any authenticated staff may read a single product
  const auth = await requireAuth(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params
    const product = await db.product.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true } },
        batches: {
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!product) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      )
    }

    // Normalize Prisma.Decimal so the client never sees price/quantity strings
    const normalized = {
      ...product,
      defaultCostPrice: Number(product.defaultCostPrice),
      defaultSellingPrice: Number(product.defaultSellingPrice),
      batches: product.batches.map((b) => ({
        ...b,
        quantity: Number(b.quantity),
        costPrice: Number(b.costPrice),
        sellingPrice: Number(b.sellingPrice),
      })),
    }

    return NextResponse.json(normalized)
  } catch (error) {
    console.error('Product get error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch product' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    // Auth from HttpOnly JWT cookie — identity is never trusted from the body
    const auth = await requireAdmin(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    const body = await request.json()

    const product = await db.product.findUnique({ where: { id } })
    if (!product) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      )
    }

    const updated = await db.product.update({
      where: { id },
      data: {
        name: body.name ?? product.name,
        genericName: body.genericName !== undefined ? body.genericName : product.genericName,
        categoryId: body.categoryId !== undefined ? body.categoryId : product.categoryId,
        description: body.description !== undefined ? body.description : product.description,
        unit: body.unit ?? product.unit,
        reorderLevel: body.reorderLevel ?? product.reorderLevel,
        defaultCostPrice: body.defaultCostPrice !== undefined ? body.defaultCostPrice : product.defaultCostPrice,
        defaultSellingPrice: body.defaultSellingPrice !== undefined ? body.defaultSellingPrice : product.defaultSellingPrice,
        active: body.active !== undefined ? body.active : product.active,
      },
      include: {
        category: { select: { id: true, name: true } },
      },
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'UPDATE',
      entity: 'Product',
      entityId: id,
      details: body.active !== undefined && body.active !== product.active
        ? `${body.active ? 'Restored' : 'Deactivated'} product "${updated.name}"`
        : `Updated product "${updated.name}"`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Product update error:', error)
    return NextResponse.json(
      { error: 'Failed to update product' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    // Auth from HttpOnly JWT cookie (DELETE sends no body)
    const auth = await requireAdmin(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const product = await db.product.findUnique({
      where: { id },
      include: {
        batches: true,
        _count: { select: { saleItems: true, batches: true } },
      },
    })
    if (!product) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      )
    }

    const permanent = request.nextUrl.searchParams.get('permanent') === 'true'

    if (permanent) {
      // Refuse to destroy history when real sales exist against this product.
      // saleItems cascade-removes stock history and falsifies daily-sales stats.
      if (product._count.saleItems > 0) {
        return NextResponse.json(
          {
            error: `This product has ${product._count.saleItems} linked sale record(s). It cannot be permanently deleted without corrupting sales history — deactivate it instead.`,
          },
          { status: 409 }
        )
      }

      const batchCount = product._count.batches
      await db.$transaction(async (tx) => {
        await tx.batch.deleteMany({ where: { productId: id } })
        await tx.product.delete({ where: { id } })
      })

      await logAudit({
        userId: auth.user!.userId,
        action: 'DELETE',
        entity: 'Product',
        entityId: id,
        details: `Permanently deleted product "${product.name}" (removed ${batchCount} batch record${batchCount !== 1 ? 's' : ''})`,
        ipAddress: getClientIp(request),
      })

      return NextResponse.json({
        message: `Product "${product.name}" permanently deleted`,
        permanent: true,
      })
    }

    // Default path: soft-deactivate so accounting/sales history stays intact
    const deactivated = await db.product.update({
      where: { id },
      data: { active: false },
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'DELETE',
      entity: 'Product',
      entityId: id,
      details: `Deactivated product "${deactivated.name}"`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({
      message: `Product "${deactivated.name}" was deactivated (not deleted)`,
      product: deactivated,
      permanent: false,
    })
  } catch (error) {
    console.error('Product delete error:', error)
    return NextResponse.json(
      { error: 'Failed to deactivate product' },
      { status: 500 }
    )
  }
}