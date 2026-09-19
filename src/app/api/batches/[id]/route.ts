import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params
    const body = await request.json()

    const batch = await db.batch.findUnique({ where: { id } })
    if (!batch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
    }

    const updated = await db.batch.update({
      where: { id },
      data: {
        // Empty batchNumber/expiry preserve the existing values — they must
        // never block saving a drug entry.
        batchNumber:
          typeof body.batchNumber === 'string' && body.batchNumber.trim()
            ? body.batchNumber.trim()
            : batch.batchNumber,
        quantity: body.quantity !== undefined ? Number(body.quantity) : batch.quantity,
        costPrice: body.costPrice !== undefined ? Number(body.costPrice) : batch.costPrice,
        sellingPrice: body.sellingPrice !== undefined ? Number(body.sellingPrice) : batch.sellingPrice,
        expiryDate:
          typeof body.expiryDate === 'string' && body.expiryDate.trim()
            ? new Date(body.expiryDate)
            : batch.expiryDate,
      },
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'UPDATE',
      entity: 'Batch',
      entityId: id,
      details: `Updated batch "${updated.batchNumber}" (qty: ${updated.quantity})`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Batch update error:', error)
    return NextResponse.json({ error: 'Failed to update batch' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params

    const batch = await db.batch.findUnique({ where: { id } })
    if (!batch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
    }

    const hasSales = await db.saleItem.count({ where: { batchId: id } })
    if (hasSales > 0) {
      return NextResponse.json(
        { error: 'Cannot delete a batch that has sales history. Set quantity to 0 instead.' },
        { status: 400 }
      )
    }

    await db.batch.delete({ where: { id } })

    await logAudit({
      userId: auth.user!.userId,
      action: 'DELETE',
      entity: 'Batch',
      entityId: id,
      details: `Deleted batch "${batch.batchNumber}"`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Batch delete error:', error)
    return NextResponse.json({ error: 'Failed to delete batch' }, { status: 500 })
  }
}
