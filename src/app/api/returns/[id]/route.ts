import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Admin-only action — identity from HttpOnly JWT cookie
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params

    const returnRecord = await db.return.findUnique({
      where: { id },
      include: {
        sale: {
          select: { id: true, totalAmount: true, status: true },
        },
      },
    })

    if (!returnRecord) {
      return NextResponse.json({ error: 'Return not found' }, { status: 404 })
    }

    // Only allow deleting pending returns
    if (returnRecord.status !== 'pending') {
      return NextResponse.json(
        { error: 'Only pending returns can be deleted. Approved or rejected returns are permanent records.' },
        { status: 400 }
      )
    }

    // Atomic: removing the return and recomputing the sale status commit together
    await db.$transaction(async (tx) => {
      await tx.return.delete({ where: { id } })

      // Recalculate sale status since a pending return was removed
      const remainingReturns = await tx.return.findMany({
        where: { saleId: returnRecord.saleId, status: 'approved' },
      })
      const totalReturned = remainingReturns.reduce((sum, r) => sum + r.totalRefund, 0)

      const newStatus =
        totalReturned >= returnRecord.sale.totalAmount
          ? 'returned'
          : totalReturned > 0
            ? 'partial_return'
            : 'completed'

      await tx.sale.update({
        where: { id: returnRecord.saleId },
        data: { status: newStatus },
      })
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'DELETE',
      entity: 'Return',
      entityId: id,
      details: `Deleted pending return of GHS ${returnRecord.totalRefund.toFixed(2)} for sale ${returnRecord.saleId}`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ message: 'Return deleted successfully' })
  } catch (error) {
    console.error('Return delete error:', error)
    return NextResponse.json({ error: 'Failed to delete return' }, { status: 500 })
  }
}
