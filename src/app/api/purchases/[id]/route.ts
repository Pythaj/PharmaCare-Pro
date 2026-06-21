import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/require-admin'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const purchase = await db.purchase.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true, phone: true, email: true } },
        user: { select: { id: true, name: true, role: true } },
        batches: {
          include: {
            product: { select: { id: true, name: true, unit: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!purchase) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })
    }

    return NextResponse.json(purchase)
  } catch (error) {
    console.error('Purchase fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch purchase' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId') || ''
    const auth = await requireAdmin({ userId })
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const existing = await db.purchase.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })
    }

    await db.batch.deleteMany({ where: { purchaseId: id } })
    await db.purchase.delete({ where: { id } })

    return NextResponse.json({ message: 'Purchase deleted successfully' })
  } catch (error) {
    console.error('Purchase delete error:', error)
    return NextResponse.json({ error: 'Failed to delete purchase' }, { status: 500 })
  }
}