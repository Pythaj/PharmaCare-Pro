import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const returns = await db.return.findMany({
      include: {
        sale: {
          select: {
            id: true,
            invoiceNo: true,
            totalAmount: true,
            customer: { select: { id: true, name: true, phone: true } },
            user: { select: { id: true, name: true } },
          },
        },
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ returns })
  } catch (error) {
    console.error('Returns list error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch returns' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { saleId, userId, reason, items, status = 'approved' } = body

    if (!saleId || !userId || !reason) {
      return NextResponse.json(
        { error: 'Sale ID, user ID, and reason are required' },
        { status: 400 }
      )
    }

    // Find the sale and its items
    const sale = await db.sale.findUnique({
      where: { id: saleId },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true } },
            batch: true,
          },
        },
      },
    })

    if (!sale) {
      return NextResponse.json(
        { error: 'Sale not found' },
        { status: 404 }
      )
    }

    let totalRefund = 0

    // Process return items
    if (items && items.length > 0) {
      for (const returnItem of items) {
        const saleItem = sale.items.find(
          (si) => si.id === returnItem.saleItemId
        )

        if (!saleItem) {
          return NextResponse.json(
            { error: `Sale item ${returnItem.saleItemId} not found` },
            { status: 400 }
          )
        }

        if (returnItem.quantity > saleItem.quantity) {
          return NextResponse.json(
            { error: `Cannot return more than purchased for item ${returnItem.saleItemId}` },
            { status: 400 }
          )
        }

        totalRefund += saleItem.unitPrice * returnItem.quantity

        // Add quantity back to batch if batch exists
        if (saleItem.batchId && status === 'approved') {
          await db.batch.update({
            where: { id: saleItem.batchId },
            data: { quantity: { increment: returnItem.quantity } },
          })
        }
      }
    } else {
      // Full return - refund entire sale amount
      totalRefund = sale.totalAmount

      // Add all quantities back to batches
      if (status === 'approved') {
        for (const saleItem of sale.items) {
          if (saleItem.batchId) {
            await db.batch.update({
              where: { id: saleItem.batchId },
              data: { quantity: { increment: saleItem.quantity } },
            })
          }
        }
      }
    }

    const returnRecord = await db.return.create({
      data: {
        saleId,
        userId,
        reason,
        totalRefund,
        status,
      },
      include: {
        sale: {
          select: {
            id: true,
            invoiceNo: true,
            customer: { select: { id: true, name: true } },
          },
        },
        user: { select: { id: true, name: true } },
      },
    })

    // Update sale status
    const allReturns = await db.return.findMany({
      where: { saleId, status: 'approved' },
    })

    const totalReturned = allReturns.reduce((sum, r) => sum + r.totalRefund, 0)
    const newStatus =
      totalReturned >= sale.totalAmount
        ? 'returned'
        : totalReturned > 0
          ? 'partial_return'
          : sale.status

    await db.sale.update({
      where: { id: saleId },
      data: { status: newStatus },
    })

    return NextResponse.json(returnRecord, { status: 201 })
  } catch (error) {
    console.error('Return create error:', error)
    return NextResponse.json(
      { error: 'Failed to process return' },
      { status: 500 }
    )
  }
}
