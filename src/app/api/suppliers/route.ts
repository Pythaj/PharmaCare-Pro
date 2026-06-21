import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const suppliers = await db.supplier.findMany({
      include: {
        _count: { select: { purchases: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ suppliers })
  } catch (error) {
    console.error('Suppliers list error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch suppliers' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, contact, email, phone, address } = body

    if (!name) {
      return NextResponse.json(
        { error: 'Supplier name is required' },
        { status: 400 }
      )
    }

    const supplier = await db.supplier.create({
      data: {
        name,
        contact: contact || null,
        email: email || null,
        phone: phone || null,
        address: address || null,
      },
    })

    return NextResponse.json(supplier, { status: 201 })
  } catch (error) {
    console.error('Supplier create error:', error)
    return NextResponse.json(
      { error: 'Failed to create supplier' },
      { status: 500 }
    )
  }
}
