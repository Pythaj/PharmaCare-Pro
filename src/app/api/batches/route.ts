import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('productId') || ''
    const expiringSoon = searchParams.get('expiringSoon') === 'true'

    const now = new Date()
    const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

    let where: Record<string, unknown> = {}

    if (productId) {
      where.productId = productId
    }

    if (expiringSoon) {
      where.expiryDate = { lte: ninetyDaysFromNow }
      where.quantity = { gt: 0 }
    }

    const batches = await db.batch.findMany({
      where,
      include: {
        product: {
          select: { id: true, name: true, unit: true, reorderLevel: true },
        },
        purchase: {
          select: { id: true, invoiceNo: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(batches)
  } catch (error) {
    console.error('Batches list error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch batches' },
      { status: 500 }
    )
  }
}
