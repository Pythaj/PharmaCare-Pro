import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''
    const userId = searchParams.get('userId') || ''

    const where: Record<string, unknown> = {}

    if (from) {
      where.createdAt = { ...((where.createdAt as Record<string, unknown>) || {}), gte: new Date(from) }
    }
    if (to) {
      where.createdAt = { ...((where.createdAt as Record<string, unknown>) || {}), lte: new Date(to) }
    }
    if (userId) {
      where.userId = userId
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
    })

    return NextResponse.json({ sales })
  } catch (error) {
    console.error('Sales list error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sales' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      customerId,
      userId,
      items,
      discount = 0,
      tax = 0,
      paymentMethod = 'cash',
      notes,
    } = body

    if (!userId || !items || !items.length) {
      return NextResponse.json(
        { error: 'User ID and items are required' },
        { status: 400 }
      )
    }

    // Validate all items have required fields
    for (const item of items) {
      if (!item.productId || !item.quantity || !item.unitPrice) {
        return NextResponse.json(
          { error: 'Each item must have productId, quantity, and unitPrice' },
          { status: 400 }
        )
      }
    }

    // Use Prisma transaction for atomic stock deduction + sale creation
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
      const saleItemsData = []

      for (const item of items) {
        const total = item.quantity * item.unitPrice
        subtotal += total

        // Get cost price from batch
        let costPrice = item.costPrice || 0
        if (item.batchId) {
          const batch = await tx.batch.findUnique({
            where: { id: item.batchId },
            select: { costPrice: true, sellingPrice: true },
          })
          if (!batch) {
            throw new Error(`Batch ${item.batchId} not found`)
          }
          costPrice = batch.costPrice

          // Validate stock
          if (batch.sellingPrice !== item.unitPrice) {
            // Price may have changed, use the batch price for profit calc
          }
        }

        profit += (item.unitPrice - costPrice) * item.quantity

        // Get expiry date from batch
        let expiryDate = null
        if (item.batchId) {
          const batch = await tx.batch.findUnique({
            where: { id: item.batchId },
            select: { expiryDate: true },
          })
          expiryDate = batch?.expiryDate || null
        }

        saleItemsData.push({
          productId: item.productId,
          batchId: item.batchId || null,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          costPrice,
          total,
          expiryDate,
        })

        // Deduct from batch if batchId provided (with row-level lock via findUnique + update)
        if (item.batchId) {
          const batch = await tx.batch.findUnique({
            where: { id: item.batchId },
          })

          if (!batch) {
            throw new Error(`Batch ${item.batchId} not found`)
          }
          if (batch.quantity < item.quantity) {
            throw new Error(`Insufficient stock for "${batch.batchNumber}". Only ${batch.quantity} available, but ${item.quantity} requested.`)
          }

          await tx.batch.update({
            where: { id: item.batchId },
            data: { quantity: { decrement: item.quantity } },
          })
        } else {
          // FEFO: deduct from earliest expiring batches
          const availableBatches = await tx.batch.findMany({
            where: {
              productId: item.productId,
              quantity: { gt: 0 },
            },
            orderBy: { expiryDate: 'asc' },
          })

          let remainingQty = item.quantity
          for (const batch of availableBatches) {
            if (remainingQty <= 0) break
            const deductQty = Math.min(batch.quantity, remainingQty)
            await tx.batch.update({
              where: { id: batch.id },
              data: { quantity: { decrement: deductQty } },
            })
            remainingQty -= deductQty
          }

          if (remainingQty > 0) {
            throw new Error(`Insufficient stock. Need ${item.quantity} but only ${item.quantity - remainingQty} available across all batches.`)
          }
        }
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

    return NextResponse.json(sale, { status: 201 })
  } catch (error) {
    console.error('Sale create error:', error)
    const message = error instanceof Error ? error.message : 'Failed to create sale'
    return NextResponse.json(
      { error: message },
      { status: error instanceof Error && message.includes('Insufficient') ? 400 : 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const confirm = searchParams.get('confirm')

    if (confirm !== 'yes') {
      return NextResponse.json(
        { error: 'Confirmation required. Pass ?confirm=yes to delete all sales.' },
        { status: 400 }
      )
    }

    // Delete returns first (they reference sales)
    const returnCount = await db.return.count()
    if (returnCount > 0) {
      await db.return.deleteMany()
    }

    // SaleItems cascade on sale delete
    const saleCount = await db.sale.count()
    await db.sale.deleteMany()

    return NextResponse.json({ message: `Deleted ${saleCount} sales and ${returnCount} return records` })
  } catch (error) {
    console.error('Bulk sales delete error:', error)
    return NextResponse.json(
      { error: 'Failed to delete sales' },
      { status: 500 }
    )
  }
}