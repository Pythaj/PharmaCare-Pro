import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'
import { branchRelationWhere, branchWhere, requireBranchForWrite } from '@/lib/branches'
import { recomputeDailyRecord, ensureDailyRecord } from '@/lib/daily-sales'
import { ValidationError, parseErrorResponse } from '@/lib/api-error'
import { roundMoney } from '@/lib/money'
import { decrementBatchStock, restoreBatchStock, type RestorableLine } from '@/lib/stock'
import { parsePaymentMethod, parseSaleLines, resolveSaleDate } from '@/lib/sale-input'
import { getRequireCustomer, getMaxLineItems } from '@/lib/server-settings'
import { nextInvoiceNumber } from '@/lib/invoice-sequence'
import { isUniqueViolationOn } from '@/lib/prisma-errors'

function normalizeSale(sale: any) {
  return {
    ...sale,
    subtotal: Number(sale.subtotal),
    totalAmount: Number(sale.totalAmount),
    profit: Number(sale.profit),
    items: sale.items.map((item: any) => {
      const quantity = Number(item.quantity)
      const returnedQuantity = (item.returnItems ?? []).reduce(
        (sum: number, r: any) => sum + Number(r.quantity ?? 0),
        0
      )
      return {
        ...item,
        quantity,
        unitPrice: Number(item.unitPrice),
        costPrice: Number(item.costPrice),
        total: Number(item.total),
        returnedQuantity,
        returnableQuantity: Math.max(0, quantity - returnedQuantity),
      }
    }),
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
    // 1-based page. Only meaningful together with `total`: this route used to
    // return only the first `limit` rows with no indication that more existed,
    // so the sales register silently truncated a busy day at 60 records and the
    // owner had no way to know invoices were missing.
    const pageParam = searchParams.get('page')
    const page = pageParam ? Math.max(parseInt(pageParam, 10) || 1, 1) : 1

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
            // Refund state per line, so the register can show returned
            // quantities instead of presenting a partly-returned invoice as a
            // full one.
            returnItems: {
              where: { return: { status: { in: ['approved', 'pending'] } } },
              select: { quantity: true },
            },
          },
        },
        _count: { select: { returns: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      // Skip only when paging. Without a `page` the behaviour is byte-identical
      // to before, so existing callers cannot start missing their first rows.
      ...(page > 1 ? { skip: (page - 1) * limit } : {}),
    })

    const total = await db.sale.count({ where })

    return NextResponse.json({
      sales: sales.map(normalizeSale),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    })
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
  //
  // Inside the try below, because the guard throws a ValidationError and the
  // route's catch is what turns that into a 400. Left outside, the very refusal
  // meant to protect the ledger would surface as a 500 "server error".
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
    const branchId = requireBranchForWrite(
      auth.scope!,
      'Select a branch before recording a sale'
    )
    const body = await request.json()
    const {
      customerId,
      items: rawItems,
      paymentMethod: rawPaymentMethod,
      notes,
      saleDate,
    } = body

    const paymentMethod = parsePaymentMethod(rawPaymentMethod)

    // Admin-only backdating: the sale's recorded date is its invoice day and
    // the day its register totals land on. Expiry checks use this same date.
    const { saleAt, dateKey, dayStart, dayEnd } = resolveSaleDate(saleDate, auth.user!.role)

    // Shape-checked and de-duplicated up front: lines naming the same batch are
    // merged so the guarded decrement below is asked for the combined quantity
    // rather than for each line's share of the same shelf.
    const items = parseSaleLines(rawItems)

    // maxLineItems: reject carts that exceed the configured limit
    const maxLineItems = await getMaxLineItems()
    if (items.length > maxLineItems) {
      throw new ValidationError(`Cart exceeds the maximum of ${maxLineItems} line items. Remove some items or increase the limit in Settings.`)
    }

    // requireCustomer: reject sales without a customer when enabled
    const requireCustomer = await getRequireCustomer()
    if (requireCustomer && !customerId) {
      throw new ValidationError('A customer must be selected before completing this sale. Enable "Require Customer" in Settings to change this behavior.')
    }

    // Use Prisma transaction for atomic stock deduction + sale creation.
    // Prices are derived server-side from the cheapest-eligible or selected
    // batch — the client's unitPrice is never trusted (Rule 13/14).
    //
    // The invoice number now comes from `nextInvoiceNumber`, which increments a
    // stored per-branch-per-day high-water mark instead of recounting rows. That
    // makes allocation atomic on its own, so concurrent sales no longer collide:
    // the old count-then-write needed the retry below, and a count also REISSUED a
    // number once a mis-keyed sale was deleted (count drops, next sale takes the
    // freed number, two transactions share one receipt).
    //
    // The retry is kept as a safety net rather than removed: it costs nothing,
    // and if the sequence ever disagrees with what is on file (a hand-entered
    // invoice, a restored backup) the unique constraint still catches it and
    // re-allocating is the correct response. Anything that is not a unique
    // violation on invoiceNo is re-thrown untouched, so a genuine stock or
    // validation failure is never retried or masked.
    let sale: any = null
    let lastCollision: unknown = null

    for (let attempt = 0; attempt < 5 && sale === null; attempt++) {
      try {
        sale = await db.$transaction(async (tx) => {
        // Reserve the invoice number for the sale's recorded day (supports
        // backdating: the next sequence continues that day's own invoices).
        //
        // The branch code is part of the number because the sequence is kept
        // per branch: without it, Branch A and Branch B both selling on the same
        // day would compute INV-20260926-0001 and collide on the @unique
        // constraint — or, worse, hand two customers the same receipt number.
        // `dateKey` rather than a key recomputed from `saleAt`: it is the day
        // `dayStart`/`dayEnd` were built from, so the sequence row is keyed to
        // the same window it is seeded from.
        const invoiceNo = await nextInvoiceNumber(tx, {
          branchId,
          branchCode,
          date: dateKey,
          dayStart,
          dayEnd,
        })

        let subtotal = 0
        let profit = 0
        const saleItemsData: any[] = []

        for (const item of items) {
          const quantity = item.quantity

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

        // Guarded: the quantity check above was a read, and between it and this
        // write another till can take the same units. Matching on
        // `quantity >= n` makes the loser of that race update zero rows and roll
        // the whole sale back, instead of recording stock that left the shelf.
        await decrementBatchStock(tx, {
          batchId: item.batchId,
          quantity,
          label: batch.batchNumber,
          allowNegative: allowNegativeStock,
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

          // Guarded for the same reason as the explicit-batch path above: the
          // allocation read the batch moments ago, and a concurrent sale may
          // have taken it since.
          await decrementBatchStock(tx, {
            batchId: batch.id,
            quantity: deductQty,
            label: batch.batchNumber,
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
    const totalAmount = roundMoney(subtotal)

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
        if (isUniqueViolationOn(err, 'invoiceNo')) {
          lastCollision = err
          continue
        }
        throw err
      }
    }

    if (sale === null) {
      // The retry is now only a safety net (allocation itself is atomic), so
      // reaching here means the stored sequence kept disagreeing with what is on
      // file — a hand-entered invoice number, or a restored backup. Fail loudly
      // rather than issue a number that is already taken.
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
    const mapped = parseErrorResponse(error, 'Failed to create sale')
    if (mapped) return mapped

    // The stock guard and the expiry rules can also surface as a plain Error
    // from a driver this module does not own, so the wording still decides
    // whether this was the customer's mistake or ours.
    const message = error instanceof Error ? error.message : ''
    const isClientFault = message.includes('Insufficient') || message.includes('expired')
    return NextResponse.json(
      { error: message || 'Failed to create sale' },
      { status: isClientFault ? 400 : 500 }
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

    // What each sale still owes its batches, read BEFORE the wipe.
    //
    // `DELETE` used to remove the sales and cascade their items away without
    // touching stock, so clearing a register permanently destroyed the record
    // that those units had left the shelf. The books then said the pharmacy held
    // stock it had sold, and the next purchase order was short by exactly the
    // day's takings. Voiding one sale (DELETE /api/sales/[id]) already restored
    // its units; this is the same rule applied to the whole set.
    //
    // Only the UNRETURNED units are credited back. An approved return has already
    // put its units on the shelf, and the return records are being deleted here
    // too — crediting the sold quantity as well would hand back the same units
    // twice and leave the batch holding stock that never existed.
    const salesToClear = await db.sale.findMany({
      where: branchFilter,
      select: {
        branchId: true,
        items: {
          select: {
            batchId: true,
            quantity: true,
            returnItems: {
              where: { return: { status: 'approved' } },
              select: { quantity: true },
            },
          },
        },
      },
    })

    // Net units per batch, per owning branch. Aggregating first keeps the wipe to
    // one UPDATE per batch touched rather than one per sale line, which matters
    // when the "clear sales" action covers a month of trading.
    const owedByBatch = new Map<string, RestorableLine & { branchId: string }>()
    for (const sale of salesToClear) {
      for (const item of sale.items) {
        if (!item.batchId) continue
        const returned = item.returnItems.reduce((sum, r) => sum + Number(r.quantity ?? 0), 0)
        const outstanding = Number(item.quantity) - returned
        if (outstanding <= 0) continue
        const batchKey = `${sale.branchId}:${item.batchId}`
        const current = owedByBatch.get(batchKey)
        owedByBatch.set(batchKey, {
          branchId: sale.branchId,
          batchId: item.batchId,
          quantity: (current?.quantity ?? 0) + outstanding,
        })
      }
    }

    const owedByBranch = new Map<string, RestorableLine[]>()
    for (const owed of owedByBatch.values()) {
      const lines = owedByBranch.get(owed.branchId) ?? []
      lines.push({ batchId: owed.batchId, quantity: owed.quantity })
      owedByBranch.set(owed.branchId, lines)
    }

    // A Return carries no branch of its own — it inherits one from the sale it
    // refunds — so its boundary has to be expressed through that relation, or a
    // Branch A clear would take Branch B's refunds with it.
    const returnWhere = isSingleBranch ? branchRelationWhere(scope, 'sale') : {}
    const returnCount = await db.return.count({ where: returnWhere })

    // One transaction: the credits, the return rows and the sales must all land
    // or none of them may. Restoring stock outside it would leave inventory that
    // no sale accounts for if the delete then failed.
    const saleCount = await db.$transaction(async (tx) => {
      // `restoreBatchStock` re-asserts the owner branch itself; the batch ids
      // come from the sale records, so each credit is checked against the shelf it
      // belongs to rather than trusted.
      for (const [ownerBranchId, lines] of owedByBranch) {
        await restoreBatchStock(
          tx,
          lines,
          ownerBranchId,
          `DELETE /api/sales (bulk${isSingleBranch ? ', one branch' : ', all branches'})`
        )
      }

      if (returnCount > 0) {
        await tx.return.deleteMany({ where: returnWhere })
      }

      // SaleItems cascade on sale delete
      const deleted = await tx.sale.deleteMany({ where: branchFilter })
      return deleted.count
    })

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
