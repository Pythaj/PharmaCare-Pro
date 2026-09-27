import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, requireBranchScope } from '@/lib/require-auth'
import { branchWhere } from '@/lib/branches'
import { logAudit, getClientIp } from '@/lib/audit'
import {
  parseProductName,
  parseOptionalGenericName,
  parseOptionalCategoryId,
  parseOptionalDescription,
  parseProductUnit,
  parseReorderLevel,
  parseMoney,
  parseOptionalActive,
} from '@/lib/product-input'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Any authenticated staff may read a single product
    const auth = await requireBranchScope(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

  try {
    const { id } = await params
    const product = await db.product.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true } },
        // Scoped to the active branch. The Product row itself is shared
        // catalogue, but its batches are not: returning them unfiltered let any
        // signed-in user read every branch's on-hand quantity, selling price AND
        // cost price from a product lookup. Cost price is the sensitive one — it
        // is the other shop's margin.
        batches: {
          where: branchWhere(auth.scope!),
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

    // Shared validators — this handler used to spread the raw request body into
    // Prisma, so a non-numeric price or a non-boolean `active` produced a raw
    // 500 instead of a field error.
    const updateData: Record<string, unknown> = {}

    if (body.name !== undefined) {
      const parsed = parseProductName(body.name)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      updateData.name = parsed.value
    }

    if (body.genericName !== undefined) {
      const parsed = parseOptionalGenericName(body.genericName)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      updateData.genericName = parsed.value
    }

    if (body.description !== undefined) {
      const parsed = parseOptionalDescription(body.description)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      updateData.description = parsed.value
    }

    if (body.categoryId !== undefined) {
      const parsed = parseOptionalCategoryId(body.categoryId)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      if (parsed.value && parsed.value !== product.categoryId) {
        const category = await db.category.findUnique({
          where: { id: parsed.value },
          select: { id: true },
        })
        if (!category) {
          return NextResponse.json({ error: 'Category not found' }, { status: 400 })
        }
      }
      updateData.categoryId = parsed.value
    }

    if (body.unit !== undefined) {
      const parsed = parseProductUnit(body.unit, product.unit)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      updateData.unit = parsed.value
    }

    // 0 is a valid "never reorder" level and must be preserved.
    if (body.reorderLevel !== undefined) {
      const parsed = parseReorderLevel(body.reorderLevel, product.reorderLevel)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      updateData.reorderLevel = parsed.value
    }

    if (body.defaultCostPrice !== undefined) {
      const parsed = parseMoney(
        body.defaultCostPrice,
        'Cost price',
        Number(product.defaultCostPrice)
      )
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      updateData.defaultCostPrice = parsed.value
    }

    if (body.defaultSellingPrice !== undefined) {
      const parsed = parseMoney(
        body.defaultSellingPrice,
        'Selling price',
        Number(product.defaultSellingPrice)
      )
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      updateData.defaultSellingPrice = parsed.value
    }

    if (body.active !== undefined) {
      const parsed = parseOptionalActive(body.active)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      if (parsed.value !== undefined) {
        updateData.active = parsed.value
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const updated = await db.product.update({
      where: { id },
      data: updateData,
      include: {
        category: { select: { id: true, name: true } },
      },
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'UPDATE',
      entity: 'Product',
      entityId: id,
      // Use the validated value, not the raw body, so a rejected or coerced
      // field can never be described in the audit trail as a change that
      // happened (or didn't).
      details:
        typeof updateData.active === 'boolean' && updateData.active !== product.active
          ? `${updateData.active ? 'Restored' : 'Deactivated'} product "${updated.name}"`
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
    const auth = await requireBranchScope(request, { admin: true })
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const product = await db.product.findUnique({
      where: { id },
      include: {
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

      // A Product is SHARED, so a permanent delete reaches every branch's batch
      // rows. Doing that from one branch's screen would quietly strip another
      // shop of its stock records. The business-wide delete stays available, but
      // only from the "All branches" view where that reach is obvious.
      if (auth.scope!.branchId) {
        const elsewhere = await db.batch.count({
          where: { productId: id, NOT: { branchId: auth.scope!.branchId } },
        })
        if (elsewhere > 0) {
          return NextResponse.json(
            {
              error: `This product is also stocked by another branch (${elsewhere} batch record(s)). Switch to "All branches" to delete it for everyone, or deactivate it instead.`,
            },
            { status: 409 }
          )
        }
      }

      const batchCount = product._count.batches
      await db.$transaction(async (tx) => {
        await tx.batch.deleteMany({
          where: { productId: id, ...branchWhere(auth.scope!) },
        })
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