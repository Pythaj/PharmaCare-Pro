import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, requireAuth } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'

// GET /api/daily-sales/[id] — get a specific day's record with all sales
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

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

    // Fetch all sales for this date (exclusive next-midnight bound)
    const dayStart = new Date(record.date + 'T00:00:00')
    const dayEnd = new Date(record.date + 'T00:00:00')
    dayEnd.setDate(dayEnd.getDate() + 1)

    const sales = await db.sale.findMany({
      where: { createdAt: { gte: dayStart, lt: dayEnd } },
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

// PATCH /api/daily-sales/[id] — close the day's record (staff) or reopen it (admin only)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const userId = auth.user!.userId

  try {
    const { id } = await params
    const body = await request.json()
    const { action, notes } = body

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
      const dayEnd = new Date(record.date + 'T00:00:00')
      dayEnd.setDate(dayEnd.getDate() + 1)

      const sales = await db.sale.findMany({
        where: { createdAt: { gte: dayStart, lt: dayEnd } },
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

      await logAudit({
        userId,
        action: 'CLOSE_DAY',
        entity: 'DailySalesRecord',
        entityId: id,
        details: `Closed register for ${record.date} (GHS ${totalRevenue.toFixed(2)} across ${totalTransactions} sales)`,
        ipAddress: getClientIp(request),
      })

      return NextResponse.json(updated)
    }

    if (action === 'reopen') {
      // Reopening a closed register is a privileged action
      if (auth.user!.role !== 'admin') {
        return NextResponse.json({ error: 'Admin access required to reopen a closed day' }, { status: 403 })
      }
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

      await logAudit({
        userId,
        action: 'REOPEN_DAY',
        entity: 'DailySalesRecord',
        entityId: id,
        details: `Reopened register for ${record.date}`,
        ipAddress: getClientIp(request),
      })

      return NextResponse.json(updated)
    }

    return NextResponse.json({ error: 'Invalid action. Use "close" or "reopen"' }, { status: 400 })
  } catch (error) {
    console.error('Daily sales update error:', error)
    return NextResponse.json({ error: 'Failed to update daily sales record' }, { status: 500 })
  }
}
