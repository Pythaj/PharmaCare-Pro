import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, requireAuth } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'
import { recomputeDailyRecord } from '@/lib/daily-sales'

class ValidationError extends Error {}

function normalizeSale(sale: any) {
  return {
    ...sale,
    subtotal: Number(sale.subtotal),
    tax: Number(sale.tax),
    discount: Number(sale.discount),
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
  // All roles may read sales; sales staff are scoped to their own records
  const auth = await requireAuth(request)
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

    const where: Record<string, unknown> = {}

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
  const auth = await requireAuth(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const userId = auth.user!.userId

  try {
    const body = await request.json()
    const {
      customerId,
      items,
      discount = 0,
      tax = 0,
      paymentMethod = 'cash',
      notes,
    } = body

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

    if (typeof discount !== 'number' || discount < 0 || typeof tax !== 'number' || tax < 0) {
      return NextResponse.json(
        { error: 'Discount and tax must be non-negative numbers' },
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
    const sale = await db.$transaction(async (tx) => {
      // Generate invoice number
      const today = new Date()
      const dateStr = today.toISOString().split('T')[0].replace(/-/g, '')
      const count = await tx.sale.count({
        where: {
          createdAt: {
            gte: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
          },
        },
      })
      const invoiceNo = `INV-${dateStr}-${String(count + 1).padStart(4, '0')}`

      let subtotal = 0
      let profit = 0
      const saleItemsData: any[] = []

      for (const item of items) {
        const quantity = Math.floor(Number(item.quantity))

        if (item.batchId) {
          // Explicit batch (POS sends per-batch cart lines) — price is the
          // batch's configured sellingPrice. Expired batches can never sell.
          const batch = await tx.batch.findUnique({
            where: { id: item.batchId },
          })
          if (!batch) {
            throw new ValidationError(`Batch ${item.batchId} not found`)
          }
          if (batch.productId !== item.productId) {
            throw new ValidationError(`Batch ${batch.batchNumber} does not belong to that product`)
          }
          if (batch.expiryDate && new Date(batch.expiryDate) < today) {
            throw new ValidationError(`Batch ${batch.batchNumber} is expired and cannot be sold — remove it from the sale.`)
          }
          if (batch.quantity < quantity) {
            throw new ValidationError(`Insufficient stock for batch "${batch.batchNumber}". Only ${batch.quantity} available, but ${quantity} requested.`)
          }

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
          const product = await tx.product.findUnique({ where: { id: item.productId } })
          if (!product) {
            throw new ValidationError(`Product ${item.productId} not found`)
          }

          const availableBatches = await tx.batch.findMany({
            where: { productId: item.productId, quantity: { gt: 0 } },
            orderBy: { expiryDate: 'asc' },
          })

          let remainingQty = quantity
          let hadExpiredOnly = false
          let reachedExpired = false

          for (const batch of availableBatches) {
            if (remainingQty <= 0) break
            const isExpired = batch.expiryDate && new Date(batch.expiryDate) < today
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
            if (reachedExpired || (hadExpiredOnly && availableBatches.every(b => b.expiryDate && new Date(b.expiryDate) < today))) {
              throw new ValidationError(`"${product.name}" stock has expired and cannot be sold — receive a fresh batch first.`)
            }
            throw new ValidationError(`Insufficient stock for "${product.name}". Need ${quantity} but only ${quantity - remainingQty} available across all batches.`)
          }
        }
      }

      // A discount can never drive the total below zero
      if (discount > subtotal) {
        throw new ValidationError('Discount cannot be greater than the subtotal')
      }

      const totalAmount = subtotal - discount + tax

      const newSale = await tx.sale.create({
        data: {
          invoiceNo,
          customerId: customerId || null,
          userId,
          subtotal,
          tax,
          discount,
          totalAmount,
          profit,
          paymentMethod,
          notes: notes || null,
          items: {
            create: saleItemsData,
          },
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
          customer: { select: { id: true, name: true, phone: true } },
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

    // Audit outside the transaction: a logging failure must not roll back a sale
    await logAudit({
      userId,
      action: 'SALE_COMPLETE',
      entity: 'Sale',
      entityId: sale.id,
      details: `Completed sale ${sale.invoiceNo} (GHS ${Number(sale.totalAmount).toFixed(2)}, ${items.length} item${items.length !== 1 ? 's' : ''}, ${paymentMethod})`,
      ipAddress: getClientIp(request),
    })

    // Keep the day's register totals in sync immediately (same pattern as the
    // sale-delete path). Runs after the transaction; a recompute failure must
    // never rewrite a completed sale into an error response.
    try {
      const saleDate = new Date(sale.createdAt)
      await recomputeDailyRecord(
        `${saleDate.getFullYear()}-${String(saleDate.getMonth() + 1).padStart(2, '0')}-${String(saleDate.getDate()).padStart(2, '0')}`
      )
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
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(request.url)
    const confirm = searchParams.get('confirm')

    if (confirm !== 'yes') {
      return NextResponse.json(
        { error: 'Confirmation required. Pass ?confirm=yes to delete all sales.' },
        { status: 400 }
      )
    }

    // Capture which days had registers before wiping, so their totals
    // can be recomputed (zeroed) afterwards instead of drifting stale
    const dailyRecords = await db.dailySalesRecord.findMany({ select: { date: true } })

    // Delete returns first (they reference sales)
    const returnCount = await db.return.count()
    if (returnCount > 0) {
      await db.return.deleteMany()
    }

    // SaleItems cascade on sale delete
    const saleCount = await db.sale.count()
    await db.sale.deleteMany()

    // Recompute register totals for every affected day (they all become 0,
    // preserving open/close history while reflecting the wiped sales)
    for (const record of dailyRecords) {
      await recomputeDailyRecord(record.date)
    }

    await logAudit({
      userId: auth.user!.userId,
      action: 'DELETE',
      entity: 'Sale',
      details: `Bulk cleared ${saleCount} sales, ${returnCount} returns and recomputed ${dailyRecords.length} daily records`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ message: `Deleted ${saleCount} sales and ${returnCount} return records` })
  } catch (error) {
    console.error('Bulk sales delete error:', error)
    return NextResponse.json(
      { error: 'Failed to delete sales' },
      { status: 500 }
    )
  }
}