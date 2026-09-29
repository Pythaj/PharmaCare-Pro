import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'
import { branchRelationWhere, branchWhere } from '@/lib/branches'
import { recomputeDailyRecord, ensureDailyRecord } from '@/lib/daily-sales'

/** Money is stored and printed to 2dp, so it is computed to 2dp. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

class ValidationError extends Error {}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

/**
 * Resolves the effective sale timestamp from an optional YYYY-MM-DD saleDate.
 * Backdating is admin-only; the current time-of-day is preserved so intra-day
 * ordering stays meaningful. Returns { dateKey, dayStart, dayEnd } helpers too.
 */
/**
 * True only for a Prisma unique-constraint failure on `Sale.invoiceNo`.
 *
 * Deliberately narrow: the sale-create path has other things that can fail
 * (insufficient stock, expired batch, expired product), and retrying those would
 * re-run side effects or mask a real business rule. Only the invoice-number
 * race is safe to retry, because the losing attempt has already rolled back.
 */
function isInvoiceNumberCollision(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: unknown; meta?: { target?: unknown } }
  if (e.code !== 'P2002') return false
  const target = e.meta?.target
  if (Array.isArray(target)) {
    return target.some((t) => String(t).includes('invoiceNo'))
  }
  // Some drivers report the constraint as a bare string.
  return typeof target === 'string' && target.includes('invoiceNo')
}

function resolveSaleDate(saleDate: unknown, role: string, now = new Date()) {
  if (!saleDate) {
    const ds = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    return { saleAt: now, dateKey: ds, dayStart, dayEnd }
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(saleDate))
  if (!m) {
    throw new ValidationError('saleDate must use the YYYY-MM-DD format')
  }
  const yyyy = Number(m[1])
  const mm = Number(m[2])
  const dd = Number(m[3])
  const dt = new Date(yyyy, mm - 1, dd)
  if (dt.getFullYear() !== yyyy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) {
    throw new ValidationError('Invalid saleDate')
  }

  const dateKey = `${yyyy}-${pad2(mm)}-${pad2(dd)}`
  const todayKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`

  if (dateKey !== todayKey && role !== 'admin') {
    throw new ValidationError('Only the admin can record a sale for a past date')
  }

  const dayStart = new Date(yyyy, mm - 1, dd)
  const dayEnd = new Date(yyyy, mm - 1, dd + 1)
  const saleAt = dateKey === todayKey
    ? now
    : new Date(yyyy, mm - 1, dd, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds())

  return { saleAt, dateKey, dayStart, dayEnd }
}

function normalizeSale(sale: any) {
  return {
    ...sale,
    subtotal: Number(sale.subtotal),
    totalAmount: Number(sale.totalAmount),
    profit: Number(sale.profit),
    items: sale.items.map((item: any) => ({
      ...item,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      costPrice: Number(item.costPrice),
      total: Number(item.total),
    })),
  }
}

export async function GET(request: NextRequest) {
  // Branch-scoped for every role. A salesperson is additionally narrowed to
  // their own till records; an admin is narrowed to whichever branch they have
  // selected, or sees the whole business when on "All branches".
  const auth = await requireBranchScope(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''
    const requestedUserId = searchParams.get('userId') || ''
    const limitParam = searchParams.get('limit')
    // Default 50, hard cap at 500 — protects against unbounded reads
    const limit = limitParam
      ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 500)
      : 50

    // Branch is the outer boundary and is applied FIRST, so every later
    // refinement (date, cashier) can only narrow within it. An admin sitting on
    // Branch A must not be able to page through Branch B's takings by asking
    // for a different date range.
    const where: Record<string, unknown> = branchWhere(auth.scope!)

    if (from) {
      where.createdAt = { ...((where.createdAt as Record<string, unknown>) || {}), gte: new Date(from) }
    }
    if (to) {
      where.createdAt = { ...((where.createdAt as Record<string, unknown>) || {}), lte: new Date(to) }
    }
    if (requestedUserId) {
      where.userId = requestedUserId
    }
    // SECURITY: non-admin users may only ever read their own sales,
    // regardless of what userId they request
    if (auth.user!.role !== 'admin') {
      where.userId = auth.user!.userId
    }

    const sales = await db.sale.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
        customer: { select: { id: true, name: true, phone: true } },
        branch: { select: { id: true, name: true, code: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, unit: true } },
            batch: { select: { id: true, batchNumber: true } },
          },
        },
        _count: { select: { returns: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return NextResponse.json({ sales: sales.map(normalizeSale) })
  } catch (error) {
    console.error('Sales list error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sales' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  // Auth from HttpOnly JWT cookie — the cashier identity comes from the token
  const auth = await requireBranchScope(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const userId = auth.user!.userId

  // A sale belongs to exactly one till. An admin looking at "All branches" is
  // browsing, not transacting — they must pick a branch before ringing up a
  // sale, otherwise the money would be unattributable to any shop.
  const branchId = auth.scope!.branchId
  if (!branchId) {
    return NextResponse.json(
      { error: 'Select a branch before recording a sale' },
      { status: 400 }
    )
  }
  const branchCode = auth.branch?.code || 'GEN'

  // Backorders: when the pharmacy allows negative stock, an out-of-stock item
  // may still be sold (the client hands over goods / records the sale now and
  // replenishes later). Read the live toggle from system settings each time so
  // a Settings change applies immediately without a redeploy.
  const allowNegSetting = await db.systemSetting.findFirst({
    where: { key: 'pos.allowNegativeStock' },
  })
  // Mirror the client-side default (src/lib/app-settings.ts) so backorders
  // work out of the box even before a Settings row is persisted. An explicit
  // 'false' stored by the admin disables them.
  const allowNegativeStock = allowNegSetting ? allowNegSetting.value === 'true' : true

  try {
    const body = await request.json()
    const {
      customerId,
      items,
      paymentMethod = 'cash',
      notes,
      saleDate,
    } = body

    // Admin-only backdating: the sale's recorded date is its invoice day and
    // the day its register totals land on. Expiry checks use this same date.
    const { saleAt, dateKey, dayStart, dayEnd } = resolveSaleDate(saleDate, auth.user!.role)

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Items are required' },
        { status: 400 }
      )
    }

    const validPaymentMethods = ['cash', 'card', 'mobile_money']
    if (!validPaymentMethods.includes(paymentMethod)) {
      return NextResponse.json(
        { error: 'Invalid payment method' },
        { status: 400 }
      )
    }

    // Validate structure up-front
    for (const item of items) {
      if (!item.productId) {
        throw new ValidationError('Each item must have a productId')
      }
      const qty = Number(item.quantity)
      if (!Number.isInteger(qty) || qty < 1) {
        throw new ValidationError('Item quantities must be positive whole numbers')
      }
    }

    // Use Prisma transaction for atomic stock deduction + sale creation.
    // Prices are derived server-side from the cheapest-eligible or selected
    // batch — the client's unitPrice is never trusted (Rule 13/14).
    //
    // Wrapped in a retry because the invoice number is allocated from a count.
    // Two cashiers at the same branch on the same day can read the same count
    // and pick the same number; invoiceNo is @unique, so the loser gets a
    // constraint violation rather than a duplicate receipt. Retrying re-reads
    // the count and allocates the next free number, which is correct because the
    // failed attempt rolled back entirely. Anything that is not a unique
    // violation on invoiceNo is re-thrown untouched, so a genuine stock or
    // validation failure is never retried or masked.
    let sale: any = null
    let lastCollision: unknown = null

    for (let attempt = 0; attempt < 5 && sale === null; attempt++) {
      try {
        sale = await db.$transaction(async (tx) => {
        // Generate invoice number for the sale's recorded day (supports
        // backdating: the next sequence continues that day's own invoices).
        //
        // The branch code is part of the number because the sequence is counted
        // per branch: without it, Branch A and Branch B both selling on the same
        // day would compute INV-20260926-0001 and collide on the @unique
        // constraint — or, worse, hand two customers the same receipt number.
        const dateStr = `${saleAt.getFullYear()}${pad2(saleAt.getMonth() + 1)}${pad2(saleAt.getDate())}`
        const count = await tx.sale.count({
          where: {
            createdAt: { gte: dayStart, lt: dayEnd },
            branchId,
          },
        })
        const invoiceNo = `${branchCode}-INV-${dateStr}-${String(count + 1).padStart(4, '0')}`

        let subtotal = 0
        let profit = 0
        const saleItemsData: any[] = []

        for (const item of items) {
          const quantity = Math.floor(Number(item.quantity))

          if (item.batchId) {
        // Explicit batch (POS sends per-batch cart lines) — price is the
        // batch's configured sellingPrice. Expired batches can never sell.
        //
        // Branch-scoped, and this is the single most important line in the
        // handler. A Batch belongs to exactly ONE branch (Batch.branchId is
        // NOT NULL precisely so this cannot be skipped), so resolving the id
        // alone would let a cashier at Branch A sell units that are physically
        // on Branch B's shelf — decrementing stock this till does not own, and
        // stamping another branch's costPrice into this branch's profit.
        //
        // `findFirst` rather than `findUnique`: Prisma's unique `where` accepts
        // only unique fields, so a branch filter can only be expressed on a
        // general filter. The consequence is that a foreign or missing batch is
        // reported identically ("not found") on purpose — distinguishing them
        // would turn this into an existence oracle for other branches' batch
        // ids. The real reason is written to the server log below.
        const batch = await tx.batch.findFirst({
          where: { ...branchWhere(auth.scope!), id: item.batchId },
        })
        if (!batch) {
          console.error(
            `[POST /api/sales] branch ${branchId} cannot sell batch ${item.batchId}: ` +
              `no such batch, or it belongs to another branch`
          )
          throw new ValidationError(`Batch ${item.batchId} not found`)
        }
        if (batch.productId !== item.productId) {
          throw new ValidationError(`Batch ${batch.batchNumber} does not belong to that product`)
        }
        if (batch.expiryDate && new Date(batch.expiryDate) < saleAt) {
          throw new ValidationError(`Batch ${batch.batchNumber} is expired and cannot be sold — remove it from the sale.`)
        }
        if (batch.quantity < quantity && !allowNegativeStock) {
          throw new ValidationError(`Insufficient stock for batch "${batch.batchNumber}". Only ${batch.quantity} available, but ${quantity} requested.`)
        }
        // When backorders are allowed, the batch balance may go negative.
        // Its (possibly zero) balance is what gets decremented below.

        const unitPrice = Number(batch.sellingPrice)
        const costPrice = Number(batch.costPrice)
        const total = unitPrice * quantity
        subtotal += total
        profit += (unitPrice - costPrice) * quantity

        saleItemsData.push({
          productId: item.productId,
          batchId: item.batchId,
          quantity,
          unitPrice,
          costPrice,
          total,
          expiryDate: batch.expiryDate || null,
        })

        await tx.batch.update({
          where: { id: item.batchId },
          data: { quantity: { decrement: quantity } },
        })
      } else {
        // No batch: FEFO across eligible (non-expired) batches. Because
        // batches can carry different prices, each source batch becomes its
        // own line so the receipt math is always exact.
        //
        // Branch-scoped for the same reason as the explicit-batch path above,
        // and this one is easier to miss because it has no branchId in sight to
        // prompt the question: without the filter it would treat every branch's
        // shelf as this till's inventory, quietly selling Branch B's drugs at
        // Branch A's counter and then decrementing Branch B's balance.
        const product = await tx.product.findUnique({ where: { id: item.productId } })
        if (!product) {
          throw new ValidationError(`Product ${item.productId} not found`)
        }

        const availableBatches = await tx.batch.findMany({
          where: { ...branchWhere(auth.scope!), productId: item.productId, quantity: { gt: 0 } },
          orderBy: { expiryDate: 'asc' },
        })

        let remainingQty = quantity
        let hadExpiredOnly = false
        let reachedExpired = false

        for (const batch of availableBatches) {
          if (remainingQty <= 0) break
          const isExpired = batch.expiryDate && new Date(batch.expiryDate) < saleAt
          if (isExpired) {
            // Batch has stock but is expired — don't sell it. Note it so we
            // can give a precise error instead of a misleading "insufficient".
            hadExpiredOnly = true
            if (batch.quantity >= remainingQty) reachedExpired = true
            continue
          }
          hadExpiredOnly = false

          const deductQty = Math.min(batch.quantity, remainingQty)
          const unitPrice = Number(batch.sellingPrice)
          const costPrice = Number(batch.costPrice)
          const total = unitPrice * deductQty
          subtotal += total
          profit += (unitPrice - costPrice) * deductQty

          saleItemsData.push({
            productId: item.productId,
            batchId: batch.id,
            quantity: deductQty,
            unitPrice,
            costPrice,
            total,
            expiryDate: batch.expiryDate || null,
          })

          await tx.batch.update({
            where: { id: batch.id },
            data: { quantity: { decrement: deductQty } },
          })
          remainingQty -= deductQty
        }

        if (remainingQty > 0) {
          const expiredOnly = reachedExpired || (hadExpiredOnly && availableBatches.every(b => b.expiryDate && new Date(b.expiryDate) < saleAt))
          if (expiredOnly) {
            throw new ValidationError(`"${product.name}" stock has expired and cannot be sold — receive a fresh batch first.`)
          }
          if (!allowNegativeStock) {
            throw new ValidationError(`Insufficient stock for "${product.name}". Need ${quantity} but only ${quantity - remainingQty} available across all batches.`)
          }

          // Backorder: record the remaining units without touching any batch.
          // The drug is sold even though stock is at zero (client replenishes
          // after the fact), so the SaleItem simply carries no batchId and the
          // balance stays at 0 rather than going artificially negative.
          const unitPrice = Number(product.defaultSellingPrice) > 0
            ? Number(product.defaultSellingPrice)
            : (
                availableBatches.length > 0
                  ? Number(availableBatches[0].sellingPrice)
                  : 0
              )
          const costPrice = Number(product.defaultCostPrice) || 0
          const total = unitPrice * remainingQty
          subtotal += total
          profit += (unitPrice - costPrice) * remainingQty
          saleItemsData.push({
            productId: item.productId,
            batchId: null,
            quantity: remainingQty,
            unitPrice,
            costPrice,
            total,
            expiryDate: null,
          })
        }
      }
    }

    // What the customer is charged is the sum of the lines. This app has no
    // discount and no tax anywhere — Ghanaian retail pharmacy shelf prices are
    // VAT-INCLUSIVE, so a separate tax line would double-charge every customer
    // — so the total is the subtotal by definition. It is still computed (not
    // aliased) so the charged figure is derived from the same rounded line
    // totals that are persisted, and the two can never disagree by a cent.
    const totalAmount = round2(subtotal)

    const newSale = await tx.sale.create({
      data: {
        invoiceNo,
        customerId: customerId || null,
        userId,
        branchId,
        subtotal,
        totalAmount,
        profit,
        paymentMethod,
        notes: notes || null,
        createdAt: saleAt,
        items: {
          create: saleItemsData,
        },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        customer: { select: { id: true, name: true, phone: true } },
        // So the printed receipt can name the shop it came from, not just
        // encode it in the invoice number.
        branch: { select: { id: true, name: true, code: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, unit: true } },
            batch: { select: { id: true, batchNumber: true } },
          },
        },
      },
    })

        return newSale
      })
      } catch (err) {
        if (isInvoiceNumberCollision(err)) {
          lastCollision = err
          continue
        }
        throw err
      }
    }

    if (sale === null) {
      // Five concurrent sales at the same till exhausted the retry budget. The
      // counter is genuinely contended, so fail loudly rather than guess.
      console.error('Could not allocate an invoice number after 5 attempts:', lastCollision)
      throw new Error('Could not allocate an invoice number — please retry the sale')
    }

    // Audit outside the transaction: a logging failure must not roll back a sale
    await logAudit({
      userId,
      branchId,
      action: 'SALE_COMPLETE',
      entity: 'Sale',
      entityId: sale.id,
      details: `Completed sale ${sale.invoiceNo} (GHS ${Number(sale.totalAmount).toFixed(2)}, ${items.length} item${items.length !== 1 ? 's' : ''}, ${paymentMethod})`,
      ipAddress: getClientIp(request),
    })

    // Keep the day's register totals in sync immediately (same pattern as the
    // sale-delete path). Runs after the transaction; a recompute failure must
    // never rewrite a completed sale into an error response. For backdated
    // sales the register for that past date is auto-created if it is missing.
    try {
      await ensureDailyRecord(dateKey, userId, branchId)
    } catch (error) {
      console.error('Daily record recompute after sale error:', error)
    }

    return NextResponse.json(normalizeSale(sale), { status: 201 })
  } catch (error) {
    console.error('Sale create error:', error)
    const message = error instanceof Error ? error.message : 'Failed to create sale'
    const isValidation = error instanceof ValidationError ||
      (error instanceof Error && (message.includes('Insufficient') || message.includes('expired')))
    return NextResponse.json(
      { error: message },
      { status: isValidation ? 400 : 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  // DESTRUCTIVE bulk operation — admin only
  const auth = await requireBranchScope(request, { admin: true })
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(request.url)
    const confirm = searchParams.get('confirm')

    // Scoped to the active branch. This used to be an unconditional
    // `sale.deleteMany()`: with branches that is not merely broad but wrong. An
    // admin managing Branch A who pressed "clear sales" on Branch A's screen
    // erased every branch's entire sales history, and `?confirm=yes` was the
    // only thing standing between a routine action and that outcome. A
    // branch-scoped admin now clears only their own branch; wiping the whole
    // chain stays possible, but only from the deliberate "All branches" view
    // where the scope is unambiguous.
    if (confirm !== 'yes') {
      return NextResponse.json(
        {
          error: auth.scope!.branchId
            ? 'Confirmation required. Pass ?confirm=yes to delete all sales for this branch.'
            : 'Confirmation required. Pass ?confirm=yes to delete ALL sales for EVERY branch.',
        },
        { status: 400 }
      )
    }

    const scope = auth.scope!
    const branchFilter = branchWhere(scope)
    const isSingleBranch = !!scope.branchId

    // Capture which registers existed before wiping, so each one's totals can be
    // recomputed (zeroed) afterwards instead of drifting stale. branchId is part
    // of the key: two branches can each have a register for the same date.
    const dailyRecords = await db.dailySalesRecord.findMany({
      where: branchFilter,
      select: { date: true, branchId: true },
    })

    // Delete returns first (they reference sales). A Return carries no branch of
    // its own — it inherits one from the sale it refunds — so its boundary has
    // to be expressed through that relation, or a Branch A clear would take
    // Branch B's refunds with it.
    const returnWhere = isSingleBranch ? branchRelationWhere(scope, 'sale') : {}
    const returnCount = await db.return.count({ where: returnWhere })
    if (returnCount > 0) {
      await db.return.deleteMany({ where: returnWhere })
    }

    // SaleItems cascade on sale delete
    const saleCount = await db.sale.count({ where: branchFilter })
    await db.sale.deleteMany({ where: branchFilter })

    // Recompute register totals for every affected day (they all become 0,
    // preserving open/close history while reflecting the wiped sales)
    for (const record of dailyRecords) {
      await recomputeDailyRecord(record.date, undefined, record.branchId)
    }

    await logAudit({
      userId: auth.user!.userId,
      action: 'DELETE',
      entity: 'Sale',
      details: `Bulk cleared ${saleCount} sales, ${returnCount} returns and recomputed ${dailyRecords.length} daily records${isSingleBranch ? ' (this branch)' : ' (ALL branches)'}`,
      branchId: scope.branchId,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({
      message: isSingleBranch
        ? `Deleted ${saleCount} sales and ${returnCount} return records for this branch`
        : `Deleted ${saleCount} sales and ${returnCount} return records across ALL branches`,
    })
  } catch (error) {
    console.error('Bulk sales delete error:', error)
    return NextResponse.json(
      { error: 'Failed to delete sales' },
      { status: 500 }
    )
  }
}
