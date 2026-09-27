import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, requireBranchScope } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'
import { classifyProductExpiry, classifyStock, daysUntil } from '@/lib/inventory-alerts'
import {
  parseProductName,
  parseOptionalGenericName,
  parseOptionalCategoryId,
  parseOptionalDescription,
  parseProductUnit,
  parseReorderLevel,
  parseMoney,
} from '@/lib/product-input'

export async function GET(request: NextRequest) {
  const auth = await requireBranchScope(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''
    const categoryId = searchParams.get('categoryId') || ''
    // includeInactive=true reveals soft-deactivated products (for restore/audit)
    const includeInactive = searchParams.get('includeInactive') === 'true'

    const conditions: any[] = []
    if (!includeInactive) {
      conditions.push({ active: true })
    }
    if (categoryId && categoryId !== 'all') {
      conditions.push({ categoryId })
    }

    const where = conditions.length > 0 ? { AND: conditions } : {}

    // The product ROW is shared catalogue data - every branch sells the same
    // medicines at the same catalogue price. Its STOCK is not: the batches
    // below are filtered to the caller's branch, so totalStock, the price the
    // POS charges, the earliest expiry and the "in stock" badge all describe
    // what this branch can actually sell. Without this filter a cashier at
    // Branch A sees Branch B's units, sells against a batch sitting in the
    // other building, and drives that branch's quantity negative.
    const branchId = auth.scope!.branchId
    const batchScope = branchId ? { branchId } : {}

    const products = await db.product.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        _count: {
          select: {
            batches: { where: batchScope },
            saleItems: true,
          },
        },
        batches: {
          where: { ...batchScope, quantity: { gt: 0 } },
          select: { id: true, batchNumber: true, quantity: true, costPrice: true, sellingPrice: true, expiryDate: true },
          orderBy: { expiryDate: 'asc' },
        },
      },
      // A–Z by default. Products are cheap to enumerate for a pharmacy and the
      // search below runs in-memory for case-insensitive correctness on every
      // provider (SQLite/Postgres alike).
      orderBy: { name: 'asc' },
    })

    const now = new Date()

    const productsWithStock = products.map((p) => {
      const totalStock = p.batches.reduce((sum, b) => sum + b.quantity, 0);
      const minSellingPrice = p.batches.length > 0
        ? Math.min(...p.batches.map(b => Number(b.sellingPrice)))
        : Number(p.defaultSellingPrice || 0);
      // Normalize Prisma.Decimal (serialized as strings on Postgres / sqlite JSON)
      const batchesWithQty = p.batches.map(b => ({
        ...b,
        quantity: Number(b.quantity),
        currentQty: Number(b.quantity),
        costPrice: Number(b.costPrice),
        sellingPrice: Number(b.sellingPrice),
      }));

      // Calculate earliest expiry
      const earliestExpiry = p.batches.length > 0 ? p.batches[0].expiryDate : null;

      // Days to the earliest batch expiry (null when nothing is on the shelf).
      // Shared helpers so this screen, the inventory alerts and both dashboards
      // agree on what "expiring soon" means and on the 90-day window.
      const daysToExpiry: number | null = earliestExpiry
        ? daysUntil(earliestExpiry, now)
        : null;

      const expiryStatus = classifyProductExpiry(
        p.batches.map((b) => b.expiryDate),
        now
      );
      const hasExpiredBatches = expiryStatus === 'expired';
      const hasExpiringBatches = expiryStatus === 'expiring_soon';

      // Combined stock status, from the shared classifier.
      const stockStatus = classifyStock(totalStock, p.reorderLevel);

      return {
        id: p.id,
        name: p.name,
        genericName: p.genericName,
        categoryId: p.categoryId,
        description: p.description,
        unit: p.unit,
        reorderLevel: p.reorderLevel,
        defaultCostPrice: Number(p.defaultCostPrice),
        defaultSellingPrice: Number(p.defaultSellingPrice),
        active: p.active,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        category: p.category,
        _count: p._count,
        batches: batchesWithQty,
        totalStock,
        minSellingPrice: Number(minSellingPrice),
        earliestExpiry,
        daysToExpiry,
        hasExpiringBatches,
        hasExpiredBatches,
        stockStatus,
        expiryStatus,
      };
    })

    // Case-insensitive search across every field a cashier might type — name,
    // generic name, description, category and even a batch number. Runs
    // in-memory so casing never hides a drug on any database provider.
    let results = productsWithStock
    if (search && search.trim()) {
      const q = search.trim().toLowerCase()
      results = productsWithStock.filter((p) => {
        const haystack = [
          p.name,
          p.genericName,
          p.description,
          p.category?.name,
          ...p.batches.map((b) => b.batchNumber),
        ]
        return haystack.some((field) => field && field.toLowerCase().includes(q))
      })
    }

    // Stable A–Z (case-insensitive natural ordering) so the shelf always looks tidy
    results.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    )

    return NextResponse.json({ products: results })
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
    // Auth from HttpOnly JWT cookie — identity is never trusted from the body
    const auth = await requireAdmin(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    const { name, genericName, categoryId, description, unit, reorderLevel, defaultCostPrice, defaultSellingPrice } = body

    // Shared validators — see lib/product-input for what these replaced.
    const parsedName = parseProductName(name)
    if (!parsedName.ok) {
      return NextResponse.json({ error: parsedName.error }, { status: 400 })
    }

    const parsedGenericName = parseOptionalGenericName(genericName)
    if (!parsedGenericName.ok) {
      return NextResponse.json({ error: parsedGenericName.error }, { status: 400 })
    }

    const parsedCategoryId = parseOptionalCategoryId(categoryId)
    if (!parsedCategoryId.ok) {
      return NextResponse.json({ error: parsedCategoryId.error }, { status: 400 })
    }

    const parsedDescription = parseOptionalDescription(description)
    if (!parsedDescription.ok) {
      return NextResponse.json({ error: parsedDescription.error }, { status: 400 })
    }

    const parsedUnit = parseProductUnit(unit)
    if (!parsedUnit.ok) {
      return NextResponse.json({ error: parsedUnit.error }, { status: 400 })
    }

    // 0 means "never reorder" and must survive: `reorderLevel || 10` used to
    // overwrite it and quietly flag the product as low stock forever.
    const parsedReorderLevel = parseReorderLevel(reorderLevel, 10)
    if (!parsedReorderLevel.ok) {
      return NextResponse.json({ error: parsedReorderLevel.error }, { status: 400 })
    }

    const parsedCost = parseMoney(defaultCostPrice, 'Cost price', 0)
    if (!parsedCost.ok) {
      return NextResponse.json({ error: parsedCost.error }, { status: 400 })
    }

    const parsedSelling = parseMoney(defaultSellingPrice, 'Selling price', 0)
    if (!parsedSelling.ok) {
      return NextResponse.json({ error: parsedSelling.error }, { status: 400 })
    }

    if (parsedCategoryId.value) {
      const category = await db.category.findUnique({
        where: { id: parsedCategoryId.value },
        select: { id: true },
      })
      if (!category) {
        return NextResponse.json({ error: 'Category not found' }, { status: 400 })
      }
    }

    const product = await db.product.create({
      data: {
        name: parsedName.value,
        genericName: parsedGenericName.value,
        categoryId: parsedCategoryId.value,
        description: parsedDescription.value,
        unit: parsedUnit.value,
        reorderLevel: parsedReorderLevel.value,
        defaultCostPrice: parsedCost.value,
        defaultSellingPrice: parsedSelling.value,
      },
      include: {
        category: { select: { id: true, name: true } },
      },
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'CREATE',
      entity: 'Product',
      entityId: product.id,
      details: `Created product "${product.name}"`,
      ipAddress: getClientIp(request),
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
