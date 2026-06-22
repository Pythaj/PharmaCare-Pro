import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/daily-sales/[id] — get a specific day's record with all sales
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const record = await db.dailySalesRecord.findUnique({
      where: { id },
      include: {
        opener: { select: { id: true, name: true } },
        closer: { select: { id: true, name: true } },
      },
    })

    if (!record) {
      return NextResponse.json({ error: 'Daily sales record not found' }, { status: 404 })
    }

    // Fetch all sales for this date
    const dayStart = new Date(record.date + 'T00:00:00')
    const dayEnd = new Date(record.date + 'T23:59:59')

    const sales = await db.sale.findMany({
      where: { createdAt: { gte: dayStart, lte: dayEnd } },
      include: {
        user: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true, phone: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, unit: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ record, sales })
  } catch (error) {
    console.error('Daily sales detail error:', error)
    return NextResponse.json({ error: 'Failed to fetch daily sales record' }, { status: 500 })
  }
}

// PATCH /api/daily-sales/[id] — close/submit the day's record
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { action, userId, notes } = body

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    // Validate userId exists
    const userExists = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!userExists) {
      return NextResponse.json({ error: 'User not found' }, { status: 400 })
    }

    const record = await db.dailySalesRecord.findUnique({ where: { id } })

    if (!record) {
      return NextResponse.json({ error: 'Daily sales record not found' }, { status: 404 })
    }

    if (action === 'close') {
      if (record.status === 'closed') {
        return NextResponse.json({ error: 'This day is already closed' }, { status: 400 })
      }

      // Recalculate final stats
      const dayStart = new Date(record.date + 'T00:00:00')
      const dayEnd = new Date(record.date + 'T23:59:59')

      const sales = await db.sale.findMany({
        where: { createdAt: { gte: dayStart, lte: dayEnd } },
        include: { items: true },
      })

      const totalRevenue = sales.reduce((sum, s) => sum + s.totalAmount, 0)
      const totalProfit = sales.reduce((sum, s) => sum + s.profit, 0)
      const totalDiscount = sales.reduce((sum, s) => sum + s.discount, 0)
      const totalTransactions = sales.length
      const totalItemsSold = sales.reduce((sum, s) => sum + (s.items?.reduce((is, i) => is + i.quantity, 0) || 0), 0)
      const cashTotal = sales.filter(s => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.totalAmount, 0)
      const cardTotal = sales.filter(s => s.paymentMethod === 'card').reduce((sum, s) => sum + s.totalAmount, 0)
      const mobileMoneyTotal = sales.filter(s => s.paymentMethod === 'mobile_money').reduce((sum, s) => sum + s.totalAmount, 0)

      const updated = await db.dailySalesRecord.update({
        where: { id },
        data: {
          status: 'closed',
          closedBy: userId,
          closedAt: new Date(),
          totalRevenue,
          totalProfit,
          totalDiscount,
          totalTransactions,
          totalItemsSold,
          cashTotal,
          cardTotal,
          mobileMoneyTotal,
          notes: notes || record.notes,
        },
        include: {
          opener: { select: { id: true, name: true } },
          closer: { select: { id: true, name: true } },
        },
      })

      return NextResponse.json(updated)
    }

    if (action === 'reopen') {
      if (record.status === 'open') {
        return NextResponse.json({ error: 'This day is already open' }, { status: 400 })
      }

      const updated = await db.dailySalesRecord.update({
        where: { id },
        data: {
          status: 'open',
          closedBy: null,
          closedAt: null,
        },
        include: {
          opener: { select: { id: true, name: true } },
          closer: { select: { id: true, name: true } },
        },
      })

      return NextResponse.json(updated)
    }

    return NextResponse.json({ error: 'Invalid action. Use "close" or "reopen"' }, { status: 400 })
  } catch (error) {
    console.error('Daily sales update error:', error)
    return NextResponse.json({ error: 'Failed to update daily sales record' }, { status: 500 })
  }
}
