import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { requireBranchForWrite } from '@/lib/branches'
import { logAudit, getClientIp } from '@/lib/audit'
import { isReturnStatus, recomputeSaleStatus } from '@/lib/returns'
import { restoreBatchStock } from '@/lib/stock'
import { ConflictError, parseErrorResponse, branchMissResponse, idExists } from '@/lib/api-error'
import { toNumber } from '@/lib/utils'

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

    // Approving a return puts units back on a shelf, so it has to be the shelf the
    // sale came off — which means the branch must be selected. See the note on
    // `POST /api/returns`: the previous `if (scope.branchId && ...)` test was
    // skipped entirely on the consolidated "All branches" view.
    const branchId = requireBranchForWrite(
      auth.scope!,
      'Switch to the branch that made this sale before approving the return — the units go back on that branch\'s shelf'
    )

    const existing = await db.return.findFirst({
      where: { id, sale: { branchId } },
      include: {
        sale: { select: { id: true, invoiceNo: true, totalAmount: true, status: true, branchId: true } },
        items: { select: { quantity: true, saleItem: { select: { batchId: true } } } },
      },
    })

    if (!existing) {
      // 403 vs 404 is part of the contract, so the miss has to be classified.
          return branchMissResponse(
            await idExists(db.return, { id }),
            'Return not found',
            'That return belongs to a different branch.'
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
      // Approving puts real units back on a real shelf, so the state change has
      // to be a single conditional write rather than a check-then-update.
      //
      // The `status === 'pending'` test above ran outside the transaction, so two
      // reviewers clicking Approve at the same moment both passed it, both ran
      // `restoreBatchStock`, and the shelf received the returned units twice —
      // inventory the pharmacy never had, created by the one action that is
      // supposed to be undoable-by-refusal rather than replayed. Claiming the row
      // with a conditional update means exactly one approval can run its side
      // effects; the loser is told the return is no longer pending.
      const claimed = await tx.return.updateMany({
        where: { id, status: 'pending' },
        data: { status },
      })
      if (claimed.count === 0) {
        throw new ConflictError('This return is no longer pending — someone else decided it first')
      }

      // Approving is the moment stock goes back and the sale is re-statused.
      // Rejecting leaves both untouched — nothing was ever moved.
      if (status === 'approved') {
        await restoreBatchStock(
          tx,
          existing.items.map((i) => ({ batchId: i.saleItem?.batchId ?? null, quantity: i.quantity })),
          existing.sale.branchId,
          `PATCH /api/returns/${id}`,
          1
        )
      }

      await recomputeSaleStatus(
        tx,
        existing.saleId,
        toNumber(existing.sale.totalAmount),
        existing.sale.status
      )

      return tx.return.findUnique({
        where: { id },
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
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'UPDATE',
      entity: 'Return',
      entityId: id,
      details: `${status === 'approved' ? 'Approved' : 'Rejected'} return of GHS ${toNumber(existing.totalRefund).toFixed(2)} for sale ${existing.sale.invoiceNo}`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Return update error:', error)
    const mapped = parseErrorResponse(error, 'Failed to update return')
    if (mapped) return mapped
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

    const branchId = requireBranchForWrite(
      auth.scope!,
      'Switch to the branch that made this sale before cancelling the return'
    )

    const returnRecord = await db.return.findFirst({
      where: { id, sale: { branchId } },
      include: {
        sale: {
          select: { id: true, invoiceNo: true, totalAmount: true, status: true, branchId: true },
        },
      },
    })

    if (!returnRecord) {
      // 403 vs 404 is part of the contract, so the miss has to be classified.
          return branchMissResponse(
            await idExists(db.return, { id }),
            'Return not found',
            'That return belongs to a different branch.'
          )
    }

    // Only pending returns can be cancelled
    if (returnRecord.status !== 'pending') {
      return NextResponse.json(
        { error: 'Only pending returns can be cancelled. Approved or rejected returns are permanent records.' },
        { status: 400 }
      )
    }

    // Atomic: removing the return and recomputing the sale status commit together.
    // The delete is conditional on the row still being pending, for the same
    // reason the approval is: a read-then-delete lets a cancellation that lost a
    // race to an approval go on to re-status the sale as though the approved
    // refund had never happened, leaving the till holding stock it no longer has.
    await db.$transaction(async (tx) => {
      const cancelled = await tx.return.deleteMany({ where: { id, status: 'pending' } })
      if (cancelled.count === 0) {
        throw new ConflictError('This return is no longer pending — someone else decided it first')
      }

      await recomputeSaleStatus(
        tx,
        returnRecord.saleId,
        toNumber(returnRecord.sale.totalAmount),
        returnRecord.sale.status
      )
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'DELETE',
      entity: 'Return',
      entityId: id,
      details: `Cancelled pending return of GHS ${toNumber(returnRecord.totalRefund).toFixed(2)} for sale ${returnRecord.sale.invoiceNo}`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ message: 'Return cancelled successfully' })
  } catch (error) {
    console.error('Return delete error:', error)
    const mapped = parseErrorResponse(error, 'Failed to cancel return')
    if (mapped) return mapped
    return NextResponse.json({ error: 'Failed to cancel return' }, { status: 500 })
  }
}
