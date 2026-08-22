import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, requireAuth } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'
import { recomputeDailyRecord } from '@/lib/daily-sales'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params

    const sale = await db.sale.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
        customer: { select: { id: true, name: true, phone: true, address: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, unit: true } },
            batch: { select: { id: true, batchNumber: true, expiryDate: true } },
          },
        },
        returns: true,
      },
    })

    if (!sale) {
      return NextResponse.json(
        { error: 'Sale not found' },
        { status: 404 }
      )
    }

    // SECURITY: non-admin users may only read their own sales
    if (auth.user!.role !== 'admin' && sale.userId !== auth.user!.userId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    return NextResponse.json(sale)
  } catch (error) {
    console.error('Sale get error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sale' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // DESTRUCTIVE — admin only
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params

    const sale = await db.sale.findUnique({
      where: { id },
      include: {
        _count: { select: { returns: true } },
        items: true,
      },
    })

    if (!sale) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
    }

    if (sale._count.returns > 0) {
      return NextResponse.json(
        { error: 'Cannot delete sale with existing return records' },
        { status: 400 }
      )
    }

    // Atomic: restore batch quantities BEFORE removing the sale so stock
    // never silently disappears with the record (data-integrity fix).
    await db.$transaction(async (tx) => {
      for (const item of sale.items) {
        if (!item.batchId) continue
        await tx.batch.update({
          where: { id: item.batchId },
          data: { quantity: { increment: item.quantity } },
        })
      }
      // SaleItem has onDelete: Cascade, so deleting the sale removes its items
      await tx.sale.delete({ where: { id } })
    })

    // Keep the day's register totals in sync with reality after the delete.
    // (Runs after the transaction; recomputes from actual sales so it is
    // always correct regardless of record status.)
    const deletedDate = new Date(sale.createdAt)
    await recomputeDailyRecord(
      `${deletedDate.getFullYear()}-${String(deletedDate.getMonth() + 1).padStart(2, '0')}-${String(deletedDate.getDate()).padStart(2, '0')}`
    )

    await logAudit({
      userId: auth.user!.userId,
      action: 'DELETE',
      entity: 'Sale',
      entityId: id,
      details: `Deleted sale ${sale.invoiceNo} (GHS ${sale.totalAmount.toFixed(2)}) and restored batch stock`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ message: 'Sale deleted successfully' })
  } catch (error) {
    console.error('Sale delete error:', error)
    return NextResponse.json({ error: 'Failed to delete sale' }, { status: 500 })
  }
}
