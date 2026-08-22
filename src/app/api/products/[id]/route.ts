import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    return NextResponse.json(product)
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
      details: `Updated product "${updated.name}"`,
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

    const product = await db.product.findUnique({ where: { id } })
    if (!product) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      )
    }

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

    return NextResponse.json(deactivated)
  } catch (error) {
    console.error('Product delete error:', error)
    return NextResponse.json(
      { error: 'Failed to deactivate product' },
      { status: 500 }
    )
  }
}
