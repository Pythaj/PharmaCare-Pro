import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'
import { applyReturnStock, isReturnStatus, recomputeSaleStatus } from '@/lib/returns'

/**
 * PATCH /api/returns/[id] — move a return through its lifecycle.
 *
 * A return is created either as `approved` (money and stock move immediately)
 * or as `pending` (a claim held for review). A pending return can then be
 * approved — which is when the stock actually goes back and the sale is
 * re-statused — or rejected, which closes it with no side effects. Without this
 * endpoint a pending return was a dead end: it could only ever be deleted, so
 * the "hold for review" state was a trap.
 *
 * Body: { status: 'approved' | 'rejected' }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireBranchScope(request, { admin: true })
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params
    const body = await request.json()
    const { status } = body

    if (!isReturnStatus(status) || status === 'pending') {
      return NextResponse.json(
        { error: 'Status must be "approved" or "rejected"' },
        { status: 400 }
      )
    }

    const existing = await db.return.findUnique({
      where: { id },
      include: {
        sale: { select: { id: true, invoiceNo: true, totalAmount: true, status: true, branchId: true } },
        items: { select: { quantity: true, saleItem: { select: { batchId: true } } } },
      },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Return not found' }, { status: 404 })
    }

    // Approving a return puts units back on a shelf, so it has to be the shelf
    // the sale came off.
    if (auth.scope!.branchId && existing.sale.branchId !== auth.scope!.branchId) {
      return NextResponse.json(
        { error: 'That return belongs to a different branch.' },
        { status: 403 }
      )
    }

    if (existing.status === 'approved') {
      return NextResponse.json(
        { error: 'This return is already approved and is a permanent record' },
        { status: 400 }
      )
    }
    if (existing.status === 'rejected') {
      return NextResponse.json(
        { error: 'This return was already rejected and cannot change state' },
        { status: 400 }
      )
    }

    const updated = await db.$transaction(async (tx) => {
      const record = await tx.return.update({
        where: { id },
        data: { status },
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

      // Approving is the moment stock goes back and the sale is re-statused.
      // Rejecting leaves both untouched — nothing was ever moved.
      if (status === 'approved') {
        await applyReturnStock(
          tx,
          existing.items.map((i) => ({ batchId: i.saleItem?.batchId ?? null, quantity: i.quantity })),
          1
        )
      }

      await recomputeSaleStatus(
        tx,
        existing.saleId,
        Number(existing.sale.totalAmount),
        existing.sale.status
      )

      return record
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'UPDATE',
      entity: 'Return',
      entityId: id,
      details: `${status === 'approved' ? 'Approved' : 'Rejected'} return of GHS ${existing.totalRefund.toFixed(2)} for sale ${existing.sale.invoiceNo}`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Return update error:', error)
    return NextResponse.json({ error: 'Failed to update return' }, { status: 500 })
  }
}

/**
 * DELETE /api/returns/[id] — cancel a return that never took effect.
 *
 * Only a `pending` return can be cancelled: it moved no stock and no money, so
 * removing it is a clean undo. An approved return is a permanent financial
 * record — cancelling it would silently un-refund money already handed over and
 * put returned stock back on the shelf a second time, so it is refused.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Admin-only action — identity from HttpOnly JWT cookie
  const auth = await requireBranchScope(request, { admin: true })
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params

    const returnRecord = await db.return.findUnique({
      where: { id },
      include: {
        sale: {
          select: { id: true, invoiceNo: true, totalAmount: true, status: true, branchId: true },
        },
      },
    })

    if (!returnRecord) {
      return NextResponse.json({ error: 'Return not found' }, { status: 404 })
    }

    if (auth.scope!.branchId && returnRecord.sale.branchId !== auth.scope!.branchId) {
      return NextResponse.json(
        { error: 'That return belongs to a different branch.' },
        { status: 403 }
      )
    }

    // Only pending returns can be cancelled
    if (returnRecord.status !== 'pending') {
      return NextResponse.json(
        { error: 'Only pending returns can be cancelled. Approved or rejected returns are permanent records.' },
        { status: 400 }
      )
    }

    // Atomic: removing the return and recomputing the sale status commit together
    await db.$transaction(async (tx) => {
      await tx.return.delete({ where: { id } })
      await recomputeSaleStatus(
        tx,
        returnRecord.saleId,
        Number(returnRecord.sale.totalAmount),
        returnRecord.sale.status
      )
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'DELETE',
      entity: 'Return',
      entityId: id,
      details: `Cancelled pending return of GHS ${returnRecord.totalRefund.toFixed(2)} for sale ${returnRecord.sale.invoiceNo}`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ message: 'Return cancelled successfully' })
  } catch (error) {
    console.error('Return delete error:', error)
    return NextResponse.json({ error: 'Failed to cancel return' }, { status: 500 })
  }
}
