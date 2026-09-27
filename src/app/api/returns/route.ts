import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'
import { branchRelationWhere } from '@/lib/branches'
import {
  allocateRefunds,
  applyReturnStock,
  isReturnStatus,
  recomputeSaleStatus,
  sumRefunds,
  RETURN_STATUSES,
} from '@/lib/returns'

/** Distinguishes client-facing validation failures from unexpected server errors */
class ValidationError extends Error {}

// Returns are an admin-managed area (returns move stock and money), so the gate
// is requireAdmin for reads and writes alike. Reads are still branch-scoped: an
// admin parked on Branch A should reconcile Branch A's refunds, not the whole
// company's. A return inherits its branch from the sale it refunds, so the
// filter is on the related sale.
export async function GET(request: NextRequest) {
  const auth = await requireBranchScope(request, { admin: true })
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const returns = await db.return.findMany({
      where: branchRelationWhere(auth.scope!, 'sale'),
      include: {
        sale: {
          select: {
            id: true,
            invoiceNo: true,
            totalAmount: true,
            branchId: true,
            branch: { select: { id: true, name: true, code: true } },
            customer: { select: { id: true, name: true, phone: true } },
            user: { select: { id: true, name: true } },
          },
        },
        // The operator who processed the refund. Nullable relation, so a deleted
        // account leaves the refund intact and simply reads as "removed user".
        user: { select: { id: true, name: true } },
        // Line-level refunds so the UI shows what was actually credited per
        // item instead of re-deriving it from shelf prices.
        items: {
          select: {
            id: true,
            saleItemId: true,
            quantity: true,
            refundAmount: true,
            saleItem: {
              select: {
                unitPrice: true,
                product: { select: { id: true, name: true } },
              },
            },
          },
        },
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
  // Identity from HttpOnly JWT cookie, resolved against the live database role.
  const auth = await requireBranchScope(request, { admin: true })
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const userId = auth.user!.userId

  try {
    const body = await request.json()
    const { saleId, reason, items, status = 'approved' } = body

    if (!saleId || typeof saleId !== 'string') {
      return NextResponse.json(
        { error: 'Sale ID is required' },
        { status: 400 }
      )
    }
    if (typeof reason !== 'string' || !reason.trim()) {
      return NextResponse.json(
        { error: 'A reason for the return is required' },
        { status: 400 }
      )
    }
    if (!isReturnStatus(status)) {
      return NextResponse.json(
        { error: `Status must be one of: ${RETURN_STATUSES.join(', ')}` },
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

    // A refund puts stock back on a shelf and money back to a customer, so it
    // must land in the branch that made the original sale. Refusing here (rather
    // than silently crediting it) keeps each shop's stock count honest: the units
    // return to the shelf they left.
    if (auth.scope!.branchId && sale.branchId !== auth.scope!.branchId) {
      return NextResponse.json(
        { error: 'That sale belongs to a different branch. Switch to its branch to process the return.' },
        { status: 403 }
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
      if (Array.isArray(items) && items.length > 0) {
        planned = []
        for (const reqItem of items) {
          const saleItem = sale.items.find((si) => si.id === reqItem?.saleItemId)
          if (!saleItem) {
            throw new ValidationError(`Sale item ${reqItem?.saleItemId} not found on this sale`)
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

      // Refund what the customer actually paid for these lines: each line's
      // share of the sale AFTER discount and tax. Refunding shelf price instead
      // over-refunds any discounted sale and leaves a "partial_return" sale that
      // can never reach "returned", because the totals no longer line up.
      const salePricing = {
        subtotal: Number(sale.subtotal),
        discount: Number(sale.discount),
        tax: Number(sale.tax),
        totalAmount: Number(sale.totalAmount),
      }
      const allocated = allocateRefunds(planned, salePricing)
      const totalRefund = sumRefunds(allocated)

      // Create the return record + its line items together
      const returnRecord = await tx.return.create({
        data: {
          saleId,
          userId,
          reason: reason.trim(),
          totalRefund,
          status,
          items: {
            create: allocated.map((p) => ({
              saleItemId: p.saleItemId,
              quantity: p.quantity,
              refundAmount: p.refundAmount,
            })),
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
        await applyReturnStock(tx, allocated, 1)
      }

      await recomputeSaleStatus(tx, saleId, salePricing.totalAmount, sale.status)

      return { returnRecord, totalRefund, invoiceNo: sale.invoiceNo }
    })

    await logAudit({
      userId,
      action: 'RETURN',
      entity: 'Return',
      entityId: result.returnRecord.id,
      details: `Processed ${status} return for ${result.invoiceNo} (refund GHS ${result.totalRefund.toFixed(2)}): ${reason.trim()}`,
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
