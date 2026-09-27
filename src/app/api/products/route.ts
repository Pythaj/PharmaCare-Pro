import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, requireBranchScope } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'
import { classifyProductExpiry, classifyStock, daysUntil } from '@/lib/inventory-alerts'
import { seedCatalogueForAllBranches } from '@/lib/catalogue-seeding'
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
    const now = new Date()

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
          // SELLABLE batches only, and this is the single definition of that
          // used by the whole product list, the POS and the dashboards.
          //
          // Expiry was missing here, so a batch sitting past its expiry date
          // still contributed to `totalStock`, still set the price the till
          // charged (via the min below), and still made the product read as
          // "in stock". A cashier could therefore sell expired medicine and see
          // it counted as available. Expired stock is not sellable stock; the
          // inventory-alerts screen remains where expiry is surfaced, so it is
          // not hidden from the owner by filtering it out of the sell list.
          where: { ...batchScope, quantity: { gt: 0 }, expiryDate: { gt: now } },
          select: { id: true, batchNumber: true, quantity: true, costPrice: true, sellingPrice: true, expiryDate: true },
          orderBy: { expiryDate: 'asc' },
        },
      },
      // A–Z by default. Products are cheap to enumerate for a pharmacy and the
      // search below runs in-memory for case-insensitive correctness on every
      // provider (SQLite/Postgres alike).
      orderBy: { name: 'asc' },
    })

    // Expired stock is excluded from the sellable set above, but the owner still
    // has to be warned about it — filtering it away would hide a real problem
    // behind a "no stock" badge. So expired quantities are counted separately in
    // one query and surfaced as a distinct flag, rather than being mixed into
    // `totalStock` or dropped altogether.
    const expiredGroups = await db.batch.groupBy({
      by: ['productId'],
      where: { ...batchScope, quantity: { gt: 0 }, expiryDate: { lte: now } },
      _count: { _all: true },
    })
    const expiredProductIds = new Set(expiredGroups.map((g) => g.productId))

    // PER-BRANCH AVAILABILITY (admin only)
    //
    // The owner managing several branches needs one question answered at a
    // glance: "where can I actually sell this?" That cannot be derived from the
    // branch-scoped batches above, which only ever describe the caller's branch.
    // So admins get an all-branch roll-up; everyone else is refused it.
    //
    // Only QUANTITY crosses the boundary, never costPrice: a branch's purchase
    // cost is that branch's business, and leaking it to another branch's admin
    // (or, via the all-branches owner view, being the only number that reveals
    // what a supplier charged) is not needed to answer "is it in stock there".
    const isAdmin = auth.scope?.isAdmin ?? false
    const includeBranchAvailability = isAdmin

    let branchAvailability: Record<string, { branchId: string; branchName: string; branchCode: string; quantity: number }[]> = {}
    if (includeBranchAvailability) {
      const activeBranches = await db.branch.findMany({
        where: { active: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      })
      const availabilityRows = await db.batch.groupBy({
        by: ['productId', 'branchId'],
        where: { quantity: { gt: 0 }, expiryDate: { gt: now } },
        _sum: { quantity: true },
      })
      const totals = new Map(
        availabilityRows.map((r) => [`${r.productId}::${r.branchId}`, r._sum.quantity ?? 0])
      )
      branchAvailability = Object.fromEntries(
        products.map((p) => [
          p.id,
          activeBranches.map((b) => ({
            branchId: b.id,
            branchName: b.name,
            branchCode: b.code,
            quantity: totals.get(`${p.id}::${b.id}`) ?? 0,
          })),
        ])
      )
    }

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

      // `p.batches` now holds only SELLABLE batches, so it can never yield
      // 'expired'. Expired stock is counted separately, and a product that has
      // any is reported as expired here so `expiryStatus` and `hasExpiredBatches`
      // cannot disagree — otherwise a future consumer reading only the status
      // string would be told "no expiry problem" about a drug that has none
      // sellable.
      const hasExpiredBatches = expiredProductIds.has(p.id);
      const sellableExpiryStatus = classifyProductExpiry(
        p.batches.map((b) => b.expiryDate),
        now
      );
      const hasExpiringBatches = sellableExpiryStatus === 'expiring_soon';
      const expiryStatus = hasExpiredBatches ? 'expired' : sellableExpiryStatus;

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
        // Admin-only; absent entirely for a salesperson rather than sent as an
        // empty array, so a sales client cannot mistake "not shown" for "no
        // branches".
        ...(includeBranchAvailability ? { branchAvailability: branchAvailability[p.id] } : {}),
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

    // Create the product AND materialise its per-branch catalogue rows in one
    // transaction. Seeding separately would leave a window where the product
    // exists but is sellable nowhere — the exact state that made a freshly added
    // drug invisible at every branch.
    const product = await db.$transaction(async (tx) => {
      const created = await tx.product.create({
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

      // Every branch gets a quantity-0 starter batch, so the drug shows up on
      // every till straight away while real quantities stay owner-entered.
      await seedCatalogueForAllBranches(tx, [created.id])

      return created
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
