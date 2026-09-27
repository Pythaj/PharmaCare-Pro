import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'
import { seedCatalogueForAllBranches } from '@/lib/catalogue-seeding'

/**
 * Case-insensitive product lookup that behaves the same on SQLite and
 * PostgreSQL. Prisma's `mode: 'insensitive'` is PostgreSQL-only, so it cannot be
 * used in a route that the desktop build also runs.
 */
async function findProductCaseInsensitive(
  tx: Prisma.TransactionClient,
  name: string
) {
  const candidates = await tx.product.findMany({
    where: { name: { contains: name } },
    select: { id: true, name: true },
  })
  const target = name.trim().toLowerCase()
  return candidates.find((c) => c.name.trim().toLowerCase() === target) ?? null
}

interface ImportRow {
  name?: string
  genericName?: string
  category?: string
  description?: string
  unit?: string
  reorderLevel?: number | string
  defaultCostPrice?: number | string
  defaultSellingPrice?: number | string
  batchNumber?: string
  quantity?: number | string
  costPrice?: number | string
  sellingPrice?: number | string
  expiryDate?: string
}

const MAX_ROWS = 5000

/** Parses a numeric cell — tolerates thousands separators, currency symbols and whitespace. */
function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const cleaned = String(value).replace(/[^\d.-]/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : 0
}

function toInt(value: number | string | null | undefined, fallback: number): number {
  const n = toNumber(value)
  return Number.isInteger(n) ? n : fallback
}

function toDateString(value: string | null | undefined): string {
  if (!value) return ''
  return String(value).trim()
}

export async function POST(request: NextRequest) {
  const auth = await requireBranchScope(request, { admin: true })
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    // Imported batches become real stock, so they must land in a specific
    // branch. There is no sensible "import into all branches" — that would
    // create the same batch in every shop and multiply the stock.
    const branchId = auth.scope!.branchId
    if (!branchId) {
      return NextResponse.json(
        { error: 'Select the branch that is receiving this stock before importing' },
        { status: 400 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const items: ImportRow[] = Array.isArray(body.items) ? body.items : []
    const onDuplicate = body.onDuplicate === 'update' ? 'update' : 'skip'

    if (items.length === 0) {
      return NextResponse.json(
        { error: 'No items provided. Expected { items: [{ name, ... }] }.' },
        { status: 400 }
      )
    }
    if (items.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `Too many rows (${items.length}). Maximum is ${MAX_ROWS} per import.` },
        { status: 400 }
      )
    }

    const result = await db.$transaction(async (tx) => {
      const counts = { created: 0, updated: 0, skipped: 0 }
      const errors: { row: number; name: string; message: string }[] = []
      // Every product the import touched, so they can be given catalogue rows at
      // all branches once the loop finishes.
      const touchedProductIds: string[] = []

      for (let i = 0; i < items.length; i++) {
        const row = items[i]
        const name = typeof row.name === 'string' ? row.name.trim() : ''

        if (!name) {
          errors.push({ row: i + 1, name: '', message: 'Product name is required' })
          continue
        }

        try {
          const unit = (typeof row.unit === 'string' && row.unit.trim()) || 'units'
          const reorderLevel = toInt(row.reorderLevel, 10)
          const defaultCostPrice = toNumber(row.defaultCostPrice)
          const defaultSellingPrice = toNumber(row.defaultSellingPrice)

          // Resolve category by name — auto-creating it when the row names a
          // category that does not exist yet (keeps imports self-contained).
          let categoryId: string | null = null
          const categoryName = typeof row.category === 'string' ? row.category.trim() : ''
          if (categoryName) {
            const existingCategory = await tx.category.findFirst({ where: { name: categoryName } })
            if (existingCategory) {
              categoryId = existingCategory.id
            } else {
              const createdCategory = await tx.category.create({ data: { name: categoryName } })
              categoryId = createdCategory.id
            }
          }

          const data = {
            name,
            genericName:
              typeof row.genericName === 'string' && row.genericName.trim()
                ? row.genericName.trim()
                : null,
            categoryId,
            description:
              typeof row.description === 'string' && row.description.trim()
                ? row.description.trim()
                : null,
            unit,
            reorderLevel,
            defaultCostPrice,
            defaultSellingPrice,
          }

          // Name is not unique in the schema, so match case-insensitively before
          // deciding to create. A plain `findFirst({ name })` is case-sensitive on
          // PostgreSQL, so uploading a spreadsheet whose header row says
          // "Paracetamol" against an existing "paracetamol" would silently create
          // a second drug. `contains` narrows the candidates on every provider and
          // the JS comparison settles the match.
          const existing = await findProductCaseInsensitive(tx, name)

          let productId: string
          if (existing) {
            if (onDuplicate === 'skip') {
              counts.skipped += 1
              // Even a skipped row must still get catalogue rows at every branch:
              // "skip" means "don't overwrite the product's details", not "leave
              // the drug invisible at other branches".
              touchedProductIds.push(existing.id)
              continue
            }
            const updated = await tx.product.update({
              where: { id: existing.id },
              data: { ...data, active: true },
            })
            productId = updated.id
            counts.updated += 1
          } else {
            const created = await tx.product.create({ data })
            productId = created.id
            counts.created += 1
          }
          touchedProductIds.push(productId)

          // Optional starting batch for stock on hand.
          const batchNumber =
            typeof row.batchNumber === 'string' && row.batchNumber.trim()
              ? row.batchNumber.trim()
              : ''
          if (batchNumber) {
            const quantity = toInt(row.quantity, 0)
            const costPrice = toNumber(row.costPrice)
            const sellingPrice = toNumber(row.sellingPrice)
            const expiry = toDateString(row.expiryDate)

            // Validate the expiry date before attempting to persist it.
            if (expiry && isNaN(Date.parse(expiry))) {
              errors.push({
                row: i + 1,
                name,
                message: `Invalid expiryDate "${expiry}" (expected YYYY-MM-DD)`,
              })
              continue
            }

            await tx.batch.upsert({
              // Batch identity is now (product, batchNumber, branch): the same
              // supplier delivery legitimately exists in more than one branch,
              // so keying on product+number alone would overwrite one shop's
              // stock with another's on import.
              where: { productId_batchNumber_branchId: { productId, batchNumber, branchId } },
              create: {
                productId,
                batchNumber,
                branchId,
                quantity,
                costPrice,
                sellingPrice,
                expiryDate: expiry ? new Date(expiry) : new Date('2099-12-31'),
              },
              update: {
                quantity,
                costPrice,
                sellingPrice,
                ...(expiry ? { expiryDate: new Date(expiry) } : {}),
              },
            })
          }
        } catch (err) {
          console.error(`Product import row ${i + 1} failed:`, err)
          errors.push({
            row: i + 1,
            name,
            message: err instanceof Error ? err.message : 'Unknown error',
          })
        }
      }

      // Imported quantities above landed ONLY in the branch running the import —
      // that is deliberate, copying real stock to every shop would invent units
      // nobody counted. The catalogue rows below are different: they are
      // quantity-0 placeholders that make the drug *visible and sellable-ready*
      // at every other branch without claiming any stock is there.
      //
      // Guarded on the list being non-empty: the helper reads an empty/absent
      // list as "seed EVERY product", so calling it after a wholly-failed import
      // would sweep the entire catalogue for no reason.
      if (touchedProductIds.length > 0) {
        await seedCatalogueForAllBranches(tx, touchedProductIds)
      }

      return { ...counts, errors }
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'CREATE',
      entity: 'Product',
      details: `Bulk import: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped (${result.errors.length} errors)`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors.slice(0, 50),
      total: items.length,
    })
  } catch (error) {
    console.error('Product bulk import error:', error)
    return NextResponse.json({ error: 'Failed to import products' }, { status: 500 })
  }
}