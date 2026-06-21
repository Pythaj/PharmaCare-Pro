import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    await db.return.delete({ where: { id } })

    // Recalculate sale status since a pending return was removed
    const remainingReturns = await db.return.findMany({
      where: { saleId: returnRecord.saleId, status: 'approved' },
    })
    const totalReturned = remainingReturns.reduce((sum, r) => sum + r.totalRefund, 0)

    const newStatus =
      totalReturned >= returnRecord.sale.totalAmount
        ? 'returned'
        : totalReturned > 0
          ? 'partial_return'
          : 'completed'

    await db.sale.update({
      where: { id: returnRecord.saleId },
      data: { status: newStatus },
    })

    return NextResponse.json({ message: 'Return deleted successfully' })
  } catch (error) {
    console.error('Return delete error:', error)
    return NextResponse.json({ error: 'Failed to delete return' }, { status: 500 })
  }
}
