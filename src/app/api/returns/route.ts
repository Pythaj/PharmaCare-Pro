import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, requireAuth } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'

/** Distinguishes client-facing validation failures from unexpected server errors */
class ValidationError extends Error {}


export async function GET(request: NextRequest) {
  // Returns are an admin-managed area; both roles may read for now,
  // matching the ReturnsView admin gating client-side
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const returns = await db.return.findMany({
      include: {
        sale: {
          select: {
            id: true,
            invoiceNo: true,
            totalAmount: true,
            customer: { select: { id: true, name: true, phone: true } },
            user: { select: { id: true, name: true } },
          },
        },
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ returns })
  } catch (error) {
    console.error('Returns list error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch returns' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  // Identity from HttpOnly JWT cookie — fixes the missing-userId payload bug
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const userId = auth.user!.userId

  try {
    const body = await request.json()
    const { saleId, reason, items, status = 'approved' } = body

    if (!saleId || !reason) {
      return NextResponse.json(
        { error: 'Sale ID and reason are required' },
        { status: 400 }
      )
    }

    const validStatuses = ['approved', 'pending', 'rejected']
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: 'Status must be "approved", "pending", or "rejected"' },
        { status: 400 }
      )
    }

    // Find the sale and its items
    const sale = await db.sale.findUnique({
      where: { id: saleId },
      include: {
        items: {
          include: { product: { select: { name: true } } },
        },
      },
    })

    if (!sale) {
      return NextResponse.json(
        { error: 'Sale not found' },
        { status: 404 }
      )
    }
    if (sale.status === 'returned') {
      return NextResponse.json(
        { error: 'This sale has already been fully returned' },
        { status: 400 }
      )
    }

    // Everything below commits atomically — a partial failure can never leave
    // stock restored without a return record (or vice versa)
    const result = await db.$transaction(async (tx) => {
      // Previously returned quantities per sale item, across ALL prior
      // returns of this sale — prevents over-returning the same line twice
      const priorReturns = await tx.returnItem.findMany({
        where: {
          return: { saleId, status: { in: ['approved', 'pending'] } },
        },
        select: { saleItemId: true, quantity: true },
      })
      const returnedQty = new Map<string, number>()
      for (const ri of priorReturns) {
        returnedQty.set(ri.saleItemId, (returnedQty.get(ri.saleItemId) ?? 0) + ri.quantity)
      }

      // Resolve which quantities are being returned in THIS request
      let planned: { saleItemId: string; quantity: number; unitPrice: number; batchId: string | null }[]
      if (items && items.length > 0) {
        planned = []
        for (const reqItem of items) {
          const saleItem = sale.items.find((si) => si.id === reqItem.saleItemId)
          if (!saleItem) {
            throw new ValidationError(`Sale item ${reqItem.saleItemId} not found on this sale`)
          }
          const qty = Number(reqItem.quantity)
          if (!Number.isInteger(qty) || qty <= 0) {
            throw new ValidationError('Return quantity must be a positive whole number')
          }
          const alreadyReturned = returnedQty.get(saleItem.id) ?? 0
          const remaining = saleItem.quantity - alreadyReturned
          if (qty > remaining) {
            throw new ValidationError(
              `Cannot return ${qty} of "${saleItem.product?.name ?? 'item'}" — only ${remaining} remain returnable` +
                ` (${alreadyReturned} of ${saleItem.quantity} already returned)`
            )
          }
          planned.push({ saleItemId: saleItem.id, quantity: qty, unitPrice: saleItem.unitPrice, batchId: saleItem.batchId })
        }
      } else {
        // Full return — refund every item's remaining un-returned quantity
        planned = sale.items
          .map((si) => ({
            saleItemId: si.id,
            quantity: si.quantity - (returnedQty.get(si.id) ?? 0),
            unitPrice: si.unitPrice,
            batchId: si.batchId,
          }))
          .filter((p) => p.quantity > 0)
        if (planned.length === 0) {
          throw new ValidationError('All items on this sale have already been returned')
        }
      }

      const totalRefund = planned.reduce((sum, p) => sum + p.unitPrice * p.quantity, 0)

      // Create the return record + its line items together
      const returnRecord = await tx.return.create({
        data: {
          saleId,
          userId,
          reason,
          totalRefund,
          status,
          items: {
            create: planned.map((p) => ({ saleItemId: p.saleItemId, quantity: p.quantity })),
          },
        },
        include: {
          sale: {
            select: {
              id: true,
              invoiceNo: true,
              customer: { select: { id: true, name: true } },
            },
          },
          user: { select: { id: true, name: true } },
        },
      })

      // Approved returns restore stock to the original batch immediately
      if (status === 'approved') {
        for (const p of planned) {
          if (p.batchId) {
            await tx.batch.update({
              where: { id: p.batchId },
              data: { quantity: { increment: p.quantity } },
            })
          }
        }
      }

      // Recompute sale status from approved refunds only
      const approvedRefunds = await tx.return.aggregate({
        where: { saleId, status: 'approved' },
        _sum: { totalRefund: true },
      })
      const totalReturned = approvedRefunds._sum.totalRefund ?? 0
      const newStatus =
        totalReturned >= sale.totalAmount - 0.001 // float tolerance
          ? 'returned'
          : totalReturned > 0
            ? 'partial_return'
            : sale.status

      await tx.sale.update({
        where: { id: saleId },
        data: { status: newStatus },
      })

      return { returnRecord, totalRefund, invoiceNo: sale.invoiceNo }
    })

    await logAudit({
      userId,
      action: 'RETURN',
      entity: 'Return',
      entityId: result.returnRecord.id,
      details: `Processed return for ${result.invoiceNo} (refund GHS ${result.totalRefund.toFixed(2)}): ${reason}`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(result.returnRecord, { status: 201 })
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('Return create error:', error)
    return NextResponse.json(
      { error: 'Failed to process return' },
      { status: 500 }
    )
  }
}
