import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/daily-sales — list all daily records (paginated, with summary)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '30')
    const status = searchParams.get('status') || '' // 'open' or 'closed'

    const where: Record<string, unknown> = {}
    if (status) where.status = status

    const [records, total] = await Promise.all([
      db.dailySalesRecord.findMany({
        where,
        include: {
          opener: { select: { id: true, name: true } },
          closer: { select: { id: true, name: true } },
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.dailySalesRecord.count({ where }),
    ])

    return NextResponse.json({ records, total, page, limit })
  } catch (error) {
    console.error('Daily sales list error:', error)
    return NextResponse.json({ error: 'Failed to fetch daily sales records' }, { status: 500 })
  }
}

// POST /api/daily-sales — open a new daily record for a given date
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { date, userId } = body

    if (!date || !userId) {
      return NextResponse.json({ error: 'Date and userId are required' }, { status: 400 })
    }

    // Check if record already exists for this date
    const existing = await db.dailySalesRecord.findUnique({ where: { date } })
    if (existing) {
      // Return existing record
      const record = await db.dailySalesRecord.findUnique({
        where: { date },
        include: {
          opener: { select: { id: true, name: true } },
          closer: { select: { id: true, name: true } },
        },
      })
      return NextResponse.json(record)
    }

    // Calculate existing sales for this date
    const dayStart = new Date(date + 'T00:00:00')
    const dayEnd = new Date(date + 'T23:59:59')

    const sales = await db.sale.findMany({
      where: {
        createdAt: { gte: dayStart, lte: dayEnd },
      },
      include: {
        items: { include: { product: { select: { name: true, unit: true } } } },
      },
    })

    const totalRevenue = sales.reduce((sum, s) => sum + s.totalAmount, 0)
    const totalProfit = sales.reduce((sum, s) => sum + s.profit, 0)
    const totalDiscount = sales.reduce((sum, s) => sum + s.discount, 0)
    const totalTransactions = sales.length
    const totalItemsSold = sales.reduce((sum, s) => sum + (s.items?.reduce((is, i) => is + i.quantity, 0) || 0), 0)
    const cashTotal = sales.filter(s => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.totalAmount, 0)
    const cardTotal = sales.filter(s => s.paymentMethod === 'card').reduce((sum, s) => sum + s.totalAmount, 0)
    const mobileMoneyTotal = sales.filter(s => s.paymentMethod === 'mobile_money').reduce((sum, s) => sum + s.totalAmount, 0)

    const record = await db.dailySalesRecord.create({
      data: {
        date,
        status: 'open',
        openedBy: userId,
        totalRevenue,
        totalProfit,
        totalDiscount,
        totalTransactions,
        totalItemsSold,
        cashTotal,
        cardTotal,
        mobileMoneyTotal,
      },
      include: {
        opener: { select: { id: true, name: true } },
        closer: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json(record, { status: 201 })
  } catch (error) {
    console.error('Create daily sales record error:', error)
    return NextResponse.json({ error: 'Failed to create daily sales record' }, { status: 500 })
  }
}
