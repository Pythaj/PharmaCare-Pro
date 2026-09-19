import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params
    const body = await request.json()

    const category = await db.category.findUnique({ where: { id } })
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    const name = body.name !== undefined ? String(body.name).trim() : category.name
    const description = body.description !== undefined ? String(body.description).trim() : category.description

    if (!name) {
      return NextResponse.json(
        { error: 'Category name cannot be empty' },
        { status: 400 }
      )
    }

    // Name conflict check (ignore self)
    const conflict = await db.category.findFirst({
      where: { name, id: { not: id } },
    })
    if (conflict) {
      return NextResponse.json(
        { error: `Another category is already named "${name}"` },
        { status: 409 }
      )
    }

    const updated = await db.category.update({
      where: { id },
      data: { name, description: description || null },
      include: { _count: { select: { products: true } } },
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'UPDATE',
      entity: 'Category',
      entityId: id,
      details: `Updated category "${updated.name}"`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Category update error:', error)
    return NextResponse.json({ error: 'Failed to update category' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params

    const category = await db.category.findUnique({ where: { id } })
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    // Deleting a category must never orphan products into an invalid state:
    // products simply lose their (now-removed) category reference.
    const result = await db.$transaction(async (tx) => {
      await tx.product.updateMany({
        where: { categoryId: id },
        data: { categoryId: null },
      })
      await tx.category.delete({ where: { id } })
      return { productsUncategorized: 0 }
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'DELETE',
      entity: 'Category',
      entityId: id,
      details: `Deleted category "${category.name}" (${result.productsUncategorized} products uncategorized)`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ success: true, name: category.name })
  } catch (error) {
    console.error('Category delete error:', error)
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 })
  }
}