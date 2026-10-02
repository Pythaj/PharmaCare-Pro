import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'
import { toNumber } from '@/lib/utils'

/**
 * GET /api/daily-sales/[id] — get a specific day's record with all sales
 *
 * A daily record belongs to exactly one branch, and the day-close recomputation
 * is MONEY. Both used to ignore the branch entirely: the sales list was filtered
 * only by date, and closing a day summed every branch's takings for that date
 * into the record. Two branches trading on the same day would produce a
 * "closed" register whose revenue matched neither of them.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireBranchScope(request)
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
        branch: { select: { id: true, name: true, code: true } },
      },
    })

    if (!record) {
      return NextResponse.json({ error: 'Daily sales record not found' }, { status: 404 })
    }

    if (auth.scope!.branchId && record.branchId !== auth.scope!.branchId) {
      return NextResponse.json(
        { error: 'That register belongs to a different branch' },
        { status: 403 }
      )
    }

    // Fetch all sales for this date (exclusive next-midnight bound), narrowed to
    // the RECORD's branch — not the caller's, so a consolidated view still
    // returns a single coherent day's book for the branch it asked about.
    const dayStart = new Date(record.date + 'T00:00:00')
    const dayEnd = new Date(record.date + 'T00:00:00')
    dayEnd.setDate(dayEnd.getDate() + 1)

    const sales = await db.sale.findMany({
      where: { branchId: record.branchId, createdAt: { gte: dayStart, lt: dayEnd } },
      include: {
        user: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true, phone: true } },
        branch: { select: { id: true, name: true, code: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, unit: true } },
            // The register's Batch column rendered "-" for every row because this
            // include never asked for the batch, while the UI, the CSV export and
            // /api/sales/[id] all expected it.
            batch: { select: { id: true, batchNumber: true } },
            // Refund state per line. Without it the register shows a day as if
            // nothing was returned against it, so the day's item counts and
            // revenue do not reconcile with the POS.
            returnItems: {
              where: { return: { status: { in: ['approved', 'pending'] } } },
              select: { quantity: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      record: {
        ...record,
        totalRevenue: toNumber(record.totalRevenue),
        totalProfit: toNumber(record.totalProfit),
        cashTotal: toNumber(record.cashTotal),
        cardTotal: toNumber(record.cardTotal),
        mobileMoneyTotal: toNumber(record.mobileMoneyTotal),
      },
      sales: sales.map((s) => ({
        ...s,
        subtotal: toNumber(s.subtotal),
        totalAmount: toNumber(s.totalAmount),
        profit: toNumber(s.profit),
        items: s.items.map((item) => {
          const quantity = Number(item.quantity)
          const returnedQuantity = (item.returnItems ?? []).reduce(
            (sum: number, r: any) => sum + Number(r.quantity ?? 0),
            0
          )
          return {
            ...item,
            quantity,
            unitPrice: toNumber(item.unitPrice),
            costPrice: toNumber(item.costPrice),
            total: toNumber(item.total),
            returnedQuantity,
            // Never negative: a return cannot exceed the sale, but a
            // hand-edited row must not present "5 sold, 7 returned" as 2
            // still returnable to a cashier.
            returnableQuantity: Math.max(0, quantity - returnedQuantity),
          }
        }),
      })),
    })
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
  const auth = await requireBranchScope(request)
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

    // You can only close or reopen your own shop's register. An admin parked on
    // Branch A closing Branch B's day would write Branch A's approval over
    // Branch B's books.
    if (auth.scope!.branchId && record.branchId !== auth.scope!.branchId) {
      return NextResponse.json(
        { error: 'That register belongs to a different branch' },
        { status: 403 }
      )
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
        where: { branchId: record.branchId, createdAt: { gte: dayStart, lt: dayEnd } },
        include: { items: true },
      })

      // Money columns are Decimal — flatten to numbers so the closing totals
      // are plain arithmetic instead of a mix of Decimal objects.
      const totals = sales.map((s) => ({
        totalAmount: toNumber(s.totalAmount),
        profit: toNumber(s.profit),
        paymentMethod: s.paymentMethod,
      }))

      const totalRevenue = totals.reduce((sum, s) => sum + s.totalAmount, 0)
      const totalProfit = totals.reduce((sum, s) => sum + s.profit, 0)
      const totalTransactions = totals.length
      const totalItemsSold = sales.reduce((sum, s) => sum + (s.items?.reduce((is, i) => is + i.quantity, 0) || 0), 0)
      const cashTotal = totals.filter(s => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.totalAmount, 0)
      const cardTotal = totals.filter(s => s.paymentMethod === 'card').reduce((sum, s) => sum + s.totalAmount, 0)
      const mobileMoneyTotal = totals.filter(s => s.paymentMethod === 'mobile_money').reduce((sum, s) => sum + s.totalAmount, 0)

      const updated = await db.dailySalesRecord.update({
        where: { id },
        data: {
          status: 'closed',
          closedBy: userId,
          closedAt: new Date(),
          totalRevenue,
          totalProfit,
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
        branchId: record.branchId,
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
        branchId: record.branchId,
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
