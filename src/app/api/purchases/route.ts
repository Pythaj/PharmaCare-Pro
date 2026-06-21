import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const purchases = await db.purchase.findMany({
      include: {
        supplier: { select: { id: true, name: true, phone: true, email: true } },
        user: { select: { id: true, name: true } },
        batches: {
          include: {
            product: { select: { id: true, name: true, unit: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ purchases })
  } catch (error) {
    console.error('Purchases list error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch purchases' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { invoiceNo, supplierId, userId, batches: batchItems, notes } = body

    if (!invoiceNo || !userId) {
      return NextResponse.json(
        { error: 'Invoice number and user ID are required' },
        { status: 400 }
      )
    }

    if (!batchItems || !batchItems.length) {
      return NextResponse.json(
        { error: 'At least one batch item is required' },
        { status: 400 }
      )
    }

    let totalAmount = 0
    const batchData = []

    for (const item of batchItems) {
      if (!item.productId || !item.batchNumber || !item.quantity || item.costPrice === undefined) {
        return NextResponse.json(
          { error: 'Each batch must have productId, batchNumber, quantity, and costPrice' },
          { status: 400 }
        )
      }

      const batchTotal = item.quantity * item.costPrice
      totalAmount += batchTotal

      batchData.push({
        productId: item.productId,
        batchNumber: item.batchNumber,
        quantity: item.quantity,
        costPrice: item.costPrice,
        sellingPrice: item.sellingPrice ?? item.costPrice,
        expiryDate: new Date(item.expiryDate),
      })
    }

    const purchase = await db.purchase.create({
      data: {
        invoiceNo,
        supplierId: supplierId || null,
        userId,
        totalAmount,
        notes: notes || null,
        batches: {
          create: batchData,
        },
      },
      include: {
        supplier: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
        batches: {
          include: {
            product: { select: { id: true, name: true, unit: true } },
          },
        },
      },
    })

    return NextResponse.json(purchase, { status: 201 })
  } catch (error) {
    console.error('Purchase create error:', error)
    return NextResponse.json(
      { error: 'Failed to create purchase' },
      { status: 500 }
    )
  }
}
