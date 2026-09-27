import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { toNumber } from '@/lib/utils'

// GET /api/daily-sales — list all daily records (paginated, with summary)
export async function GET(request: NextRequest) {
  const auth = await requireBranchScope(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '30')
    const status = searchParams.get('status') || '' // 'open' or 'closed'

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    // Branch scoping comes from the session, never the query string, so a
    // cashier cannot widen it by editing a URL.
    if (auth.scope!.branchId) where.branchId = auth.scope!.branchId

    const [records, total] = await Promise.all([
      db.dailySalesRecord.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true, code: true } },
          opener: { select: { id: true, name: true } },
          closer: { select: { id: true, name: true } },
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.dailySalesRecord.count({ where }),
    ])

    return NextResponse.json({
      records: records.map((r) => ({
        ...r,
        totalRevenue: Number(r.totalRevenue),
        totalProfit: Number(r.totalProfit),
        totalDiscount: Number(r.totalDiscount),
        cashTotal: Number(r.cashTotal),
        cardTotal: Number(r.cardTotal),
        mobileMoneyTotal: Number(r.mobileMoneyTotal),
      })),
      total, page, limit,
    })
  } catch (error) {
    console.error('Daily sales list error:', error)
    return NextResponse.json({ error: 'Failed to fetch daily sales records' }, { status: 500 })
  }
}

// POST /api/daily-sales — open a new daily record for a given date
export async function POST(request: NextRequest) {
  // Authenticated staff only; the opener identity comes from the JWT cookie
  const auth = await requireBranchScope(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await request.json()
    const { date } = body

    if (!date) {
      return NextResponse.json({ error: 'Date is required' }, { status: 400 })
    }

    // A till belongs to exactly one branch, so opening one requires a specific
    // branch. "All branches" is a read-only view — you cannot open a register
    // that has no single owner.
    const branchId = auth.scope!.branchId
    if (!branchId) {
      return NextResponse.json(
        { error: 'Select a branch before opening the daily register' },
        { status: 400 }
      )
    }

    const validUserId = auth.user!.userId

    // One register per branch per day. `date` alone is no longer unique.
    const existing = await db.dailySalesRecord.findFirst({
      where: { date, branchId },
    })
    if (existing) {
      // Return existing record
      const record = await db.dailySalesRecord.findFirst({
        where: { date, branchId },
        include: {
          branch: { select: { id: true, name: true, code: true } },
          opener: { select: { id: true, name: true } },
          closer: { select: { id: true, name: true } },
        },
      })
      return NextResponse.json(record)
    }

    // Calculate existing sales for this date
    const dayStart = new Date(date + 'T00:00:00')
    // Exclusive upper bound at next midnight (full-day coverage)
    const dayEnd = new Date(date + 'T00:00:00')
    dayEnd.setDate(dayEnd.getDate() + 1)

    const sales = await db.sale.findMany({
      where: {
        createdAt: { gte: dayStart, lt: dayEnd },
        branchId,
      },
      include: {
        items: { include: { product: { select: { name: true, unit: true } } } },
      },
    })

    // Money columns are Decimal — flatten to numbers so the register totals
    // are plain arithmetic instead of a mix of Decimal objects.
    const totals = sales.map((s) => ({
      totalAmount: toNumber(s.totalAmount),
      profit: toNumber(s.profit),
      discount: toNumber(s.discount),
      paymentMethod: s.paymentMethod,
    }))

    const totalRevenue = totals.reduce((sum, s) => sum + s.totalAmount, 0)
    const totalProfit = totals.reduce((sum, s) => sum + s.profit, 0)
    const totalDiscount = totals.reduce((sum, s) => sum + s.discount, 0)
    const totalTransactions = totals.length
    const totalItemsSold = sales.reduce((sum, s) => sum + (s.items?.reduce((is, i) => is + i.quantity, 0) || 0), 0)
    const cashTotal = totals.filter(s => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.totalAmount, 0)
    const cardTotal = totals.filter(s => s.paymentMethod === 'card').reduce((sum, s) => sum + s.totalAmount, 0)
    const mobileMoneyTotal = totals.filter(s => s.paymentMethod === 'mobile_money').reduce((sum, s) => sum + s.totalAmount, 0)

    const record = await db.dailySalesRecord.create({
      data: {
        date,
        branchId,
        status: 'open',
        openedBy: validUserId,
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
