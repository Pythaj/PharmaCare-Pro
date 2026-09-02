import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'
import { buildDailyAggregates } from '@/lib/daily-sales'

// GET /api/daily-sales/today — get or auto-create today's record with live sales
export async function GET(request: NextRequest) {
  // Authenticated staff only; identity for opener comes from the JWT cookie
  const auth = await requireAuth(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const validUserId = auth.user!.userId

    // Get today's date in YYYY-MM-DD format (using system timezone)
    const now = new Date()
    const todayStr = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0')

    const dayStart = new Date(todayStr + 'T00:00:00')
    // Exclusive upper bound at next midnight — includes the full final second
    // of the day that T23:59:59 dropped
    const dayEnd = new Date(todayStr + 'T00:00:00')
    dayEnd.setDate(dayEnd.getDate() + 1)
    const dayRange = { gte: dayStart, lt: dayEnd }

    // Find or create today's daily record
    let record = await db.dailySalesRecord.findUnique({
      where: { date: todayStr },
      include: {
        opener: { select: { id: true, name: true } },
        closer: { select: { id: true, name: true } },
      },
    })

    if (!record) {
      // Auto-create if doesn't exist — aggregates derived from existing sales
      const aggregates = await buildDailyAggregates(dayStart, dayEnd)

      record = await db.dailySalesRecord.create({
        data: {
          date: todayStr,
          status: 'open',
          openedBy: validUserId,
          ...aggregates,
        },
        include: {
          opener: { select: { id: true, name: true } },
          closer: { select: { id: true, name: true } },
        },
      })
    } else if (record.status === 'open') {
      // Refresh stats if day is still open (sales might have been added)
      const aggregates = await buildDailyAggregates(dayStart, dayEnd)

      record = await db.dailySalesRecord.update({
        where: { id: record.id },
        data: { ...aggregates },
        include: {
          opener: { select: { id: true, name: true } },
          closer: { select: { id: true, name: true } },
        },
      })
    }

    // Fetch today's actual sales with details
    const todaySales = await db.sale.findMany({
      where: { createdAt: dayRange },
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

    return NextResponse.json({
      record,
      sales: todaySales,
    })
  } catch (error) {
    console.error('Daily sales today error:', error)
    return NextResponse.json({ error: 'Failed to fetch today\'s sales record' }, { status: 500 })
  }
}
