import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/require-admin'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''
    const categoryId = searchParams.get('categoryId') || ''

    const conditions: any[] = [{ active: true }]
    if (search) {
      conditions.push({
        OR: [
          { name: { contains: search } },
          { genericName: { contains: search } },
          { description: { contains: search } },
        ],
      })
    }
    if (categoryId && categoryId !== 'all') {
      conditions.push({ categoryId })
    }

    const where = conditions.length > 0 ? { AND: conditions } : {}

    const products = await db.product.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        _count: { select: { batches: true, saleItems: true } },
        batches: {
          where: { quantity: { gt: 0 } },
          select: { id: true, batchNumber: true, quantity: true, costPrice: true, sellingPrice: true, expiryDate: true },
          orderBy: { expiryDate: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const now = new Date()

    const productsWithStock = products.map((p) => {
      const totalStock = p.batches.reduce((sum, b) => sum + b.quantity, 0);
      const minSellingPrice = p.batches.length > 0 ? Math.min(...p.batches.map(b => b.sellingPrice)) : 0;
      const batchesWithQty = p.batches.map(b => ({ ...b, currentQty: b.quantity }));

      // Calculate earliest expiry
      const earliestExpiry = p.batches.length > 0 ? p.batches[0].expiryDate : null;

      // Calculate days to earliest expiry
      let daysToExpiry: number | null = null;
      let hasExpiringBatches = false;
      let hasExpiredBatches = false;

      for (const b of p.batches) {
        const expiry = new Date(b.expiryDate);
        const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) hasExpiredBatches = true;
        else if (diffDays < 90) hasExpiringBatches = true;
      }

      if (earliestExpiry) {
        daysToExpiry = Math.ceil((new Date(earliestExpiry).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      }

      // Combined stock status
      let stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock' = 'in_stock';
      if (totalStock === 0) stockStatus = 'out_of_stock';
      else if (totalStock <= p.reorderLevel) stockStatus = 'low_stock';

      // Expiry status
      let expiryStatus: 'good' | 'expiring_soon' | 'expired' = 'good';
      if (hasExpiredBatches) expiryStatus = 'expired';
      else if (hasExpiringBatches) expiryStatus = 'expiring_soon';

      return {
        id: p.id,
        name: p.name,
        genericName: p.genericName,
        categoryId: p.categoryId,
        description: p.description,
        unit: p.unit,
        reorderLevel: p.reorderLevel,
        active: p.active,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        category: p.category,
        _count: p._count,
        batches: batchesWithQty,
        totalStock,
        minSellingPrice,
        earliestExpiry,
        daysToExpiry,
        hasExpiringBatches,
        hasExpiredBatches,
        stockStatus,
        expiryStatus,
      };
    })

    return NextResponse.json({ products: productsWithStock })
  } catch (error) {
    console.error('Products list error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch products' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const auth = await requireAdmin(body)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    const { name, genericName, categoryId, description, unit, reorderLevel } = body

    if (!name) {
      return NextResponse.json(
        { error: 'Product name is required' },
        { status: 400 }
      )
    }

    const product = await db.product.create({
      data: {
        name,
        genericName: genericName || null,
        categoryId: categoryId || null,
        description: description || null,
        unit: unit || 'units',
        reorderLevel: reorderLevel || 10,
      },
      include: {
        category: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json(product, { status: 201 })
  } catch (error) {
    console.error('Product create error:', error)
    return NextResponse.json(
      { error: 'Failed to create product' },
      { status: 500 }
    )
  }
}
