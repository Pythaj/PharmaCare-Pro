import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/daily-sales/today — get or auto-create today's record with live sales
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId') || ''

    // Validate userId exists in users table before using as FK
    let validUserId: string | undefined = undefined
    if (userId) {
      const userExists = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
      if (userExists) validUserId = userId
    }

    // Get today's date in YYYY-MM-DD format (using system timezone)
    const now = new Date()
    const todayStr = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0')

    const dayStart = new Date(todayStr + 'T00:00:00')
    const dayEnd = new Date(todayStr + 'T23:59:59')

    // Find or create today's daily record
    let record = await db.dailySalesRecord.findUnique({
      where: { date: todayStr },
      include: {
        opener: { select: { id: true, name: true } },
        closer: { select: { id: true, name: true } },
      },
    })

    // Auto-create if doesn't exist
    if (!record) {
      // Calculate existing sales for today
      const todaySales = await db.sale.findMany({
        where: { createdAt: { gte: dayStart, lte: dayEnd } },
        include: { items: true },
      })

      const totalRevenue = todaySales.reduce((sum, s) => sum + s.totalAmount, 0)
      const totalProfit = todaySales.reduce((sum, s) => sum + s.profit, 0)
      const totalDiscount = todaySales.reduce((sum, s) => sum + s.discount, 0)
      const totalTransactions = todaySales.length
      const totalItemsSold = todaySales.reduce((sum, s) => sum + (s.items?.reduce((is, i) => is + i.quantity, 0) || 0), 0)
      const cashTotal = todaySales.filter(s => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.totalAmount, 0)
      const cardTotal = todaySales.filter(s => s.paymentMethod === 'card').reduce((sum, s) => sum + s.totalAmount, 0)
      const mobileMoneyTotal = todaySales.filter(s => s.paymentMethod === 'mobile_money').reduce((sum, s) => sum + s.totalAmount, 0)

      record = await db.dailySalesRecord.create({
        data: {
          date: todayStr,
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
    } else if (record.status === 'open') {
      // Refresh stats if day is still open (sales might have been added)
      const todaySales = await db.sale.findMany({
        where: { createdAt: { gte: dayStart, lte: dayEnd } },
        include: { items: true },
      })

      const totalRevenue = todaySales.reduce((sum, s) => sum + s.totalAmount, 0)
      const totalProfit = todaySales.reduce((sum, s) => sum + s.profit, 0)
      const totalDiscount = todaySales.reduce((sum, s) => sum + s.discount, 0)
      const totalTransactions = todaySales.length
      const totalItemsSold = todaySales.reduce((sum, s) => sum + (s.items?.reduce((is, i) => is + i.quantity, 0) || 0), 0)
      const cashTotal = todaySales.filter(s => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.totalAmount, 0)
      const cardTotal = todaySales.filter(s => s.paymentMethod === 'card').reduce((sum, s) => sum + s.totalAmount, 0)
      const mobileMoneyTotal = todaySales.filter(s => s.paymentMethod === 'mobile_money').reduce((sum, s) => sum + s.totalAmount, 0)

      record = await db.dailySalesRecord.update({
        where: { id: record.id },
        data: {
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
    }

    // Fetch today's actual sales with details
    const todaySales = await db.sale.findMany({
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

    return NextResponse.json({
      record,
      sales: todaySales,
    })
  } catch (error) {
    console.error('Daily sales today error:', error)
    return NextResponse.json({ error: 'Failed to fetch today\'s sales record' }, { status: 500 })
  }
}
