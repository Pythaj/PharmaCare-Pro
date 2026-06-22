import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/require-admin'

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
    const auth = await requireAdmin(body)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
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
    const updatedProducts: string[] = []

    // Use transaction for atomic restock
    const purchase = await db.$transaction(async (tx) => {
      let txTotal = 0

      // First, create the purchase record
      const newPurchase = await tx.purchase.create({
        data: {
          invoiceNo,
          supplierId: supplierId || null,
          userId,
          totalAmount: 0, // Will update after processing batches
          notes: notes || null,
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

      for (const item of batchItems) {
        if (!item.productId || !item.batchNumber || !item.quantity || item.costPrice === undefined) {
          throw new Error('Each batch must have productId, batchNumber, quantity, and costPrice')
        }
        if (!item.expiryDate) {
          throw new Error('Each batch must have an expiry date')
        }

        const batchTotal = item.quantity * item.costPrice
        txTotal += batchTotal

        // Upsert: if same batch number exists for this product, add quantity
        await tx.batch.upsert({
          where: {
            productId_batchNumber: {
              productId: item.productId,
              batchNumber: item.batchNumber,
            },
          },
          create: {
            productId: item.productId,
            batchNumber: item.batchNumber,
            quantity: item.quantity,
            costPrice: item.costPrice,
            sellingPrice: item.sellingPrice ?? item.costPrice,
            expiryDate: new Date(item.expiryDate),
            purchaseId: newPurchase.id,
          },
          update: {
            quantity: { increment: item.quantity },
            costPrice: item.costPrice, // Update to latest cost
            sellingPrice: item.sellingPrice ?? item.costPrice,
            expiryDate: new Date(item.expiryDate),
            purchaseId: newPurchase.id,
          },
        })

        if (!updatedProducts.includes(item.productId)) {
          updatedProducts.push(item.productId)
        }
      }

      // Update total amount
      await tx.purchase.update({
        where: { id: newPurchase.id },
        data: { totalAmount: txTotal },
      })

      // Re-fetch with batches
      return await tx.purchase.findUnique({
        where: { id: newPurchase.id },
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
    })

    totalAmount = purchase?.totalAmount ?? 0

    return NextResponse.json({
      ...purchase,
      restockedProducts: updatedProducts,
    }, { status: 201 })
  } catch (error) {
    console.error('Purchase create error:', error)
    const message = error instanceof Error ? error.message : 'Failed to create purchase'
    return NextResponse.json(
      { error: message },
      { status: 400 }
    )
  }
}