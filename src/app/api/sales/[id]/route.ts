import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const sale = await db.sale.findUnique({
      where: { id },
      include: {
        _count: { select: { returns: true } },
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

    // SaleItem has onDelete: Cascade, so deleting sale removes all items
    await db.sale.delete({ where: { id } })

    return NextResponse.json({ message: 'Sale deleted successfully' })
  } catch (error) {
    console.error('Sale delete error:', error)
    return NextResponse.json({ error: 'Failed to delete sale' }, { status: 500 })
  }
}
