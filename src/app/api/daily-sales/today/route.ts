import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { buildDailyAggregates } from '@/lib/daily-sales'

// GET /api/daily-sales/today — get or auto-create today's record with live sales
export async function GET(request: NextRequest) {
  // Authenticated staff only; identity for opener comes from the JWT cookie
  const auth = await requireBranchScope(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const validUserId = auth.user!.userId

    // "Today" is per branch: a till must be opened for a specific shop, so the
    // consolidated all-branches view has no register of its own.
    const branchId = auth.scope!.branchId
    if (!branchId) {
      return NextResponse.json(
        { error: 'Select a branch to view its daily register' },
        { status: 400 }
      )
    }

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

    // Find or create today's daily record for THIS branch
    let record = await db.dailySalesRecord.findFirst({
      where: { date: todayStr, branchId },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        opener: { select: { id: true, name: true } },
        closer: { select: { id: true, name: true } },
      },
    })

    if (!record) {
      // Auto-create if doesn't exist — aggregates derived from existing sales
      const aggregates = await buildDailyAggregates(dayStart, dayEnd, undefined, branchId)

      record = await db.dailySalesRecord.create({
        data: {
          date: todayStr,
          branchId,
          status: 'open',
          openedBy: validUserId,
          ...aggregates,
        },
        include: {
          branch: { select: { id: true, name: true, code: true } },
          opener: { select: { id: true, name: true } },
          closer: { select: { id: true, name: true } },
        },
      })
    } else if (record.status === 'open') {
      // Refresh stats if day is still open (sales might have been added)
      const aggregates = await buildDailyAggregates(dayStart, dayEnd, undefined, branchId)

      record = await db.dailySalesRecord.update({
        where: { id: record.id },
        data: { ...aggregates },
        include: {
          branch: { select: { id: true, name: true, code: true } },
          opener: { select: { id: true, name: true } },
          closer: { select: { id: true, name: true } },
        },
      })
    }

    // Fetch today's actual sales with details
    const todaySales = await db.sale.findMany({
      where: { createdAt: dayRange, branchId },
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
      record: record ? {
        ...record,
        totalRevenue: Number(record.totalRevenue),
        totalProfit: Number(record.totalProfit),
        totalDiscount: Number(record.totalDiscount),
        cashTotal: Number(record.cashTotal),
        cardTotal: Number(record.cardTotal),
        mobileMoneyTotal: Number(record.mobileMoneyTotal),
      } : null,
      sales: todaySales.map((s) => ({
        ...s,
        subtotal: Number(s.subtotal),
        tax: Number(s.tax),
        discount: Number(s.discount),
        totalAmount: Number(s.totalAmount),
        profit: Number(s.profit),
        items: s.items.map((item) => ({
          ...item,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          costPrice: Number(item.costPrice),
          total: Number(item.total),
        })),
      })),
    })
  } catch (error) {
    console.error('Daily sales today error:', error)
    return NextResponse.json({ error: 'Failed to fetch today\'s sales record' }, { status: 500 })
  }
}
