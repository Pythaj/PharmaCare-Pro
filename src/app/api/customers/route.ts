import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''

    const where = search
      ? {
          OR: [
            { name: { contains: search } },
            { email: { contains: search } },
            { phone: { contains: search } },
          ],
        }
      : {}

    const customers = await db.customer.findMany({
      where,
      include: {
        _count: { select: { sales: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Attach each customer's total spend so the list can show real purchase
    // totals without making a query per row (matches GET /api/customers/[id]).
    const customerIds = customers.map((c) => c.id)
    const totals = customerIds.length > 0
      ? await db.sale.groupBy({
          by: ['customerId'],
          where: { customerId: { in: customerIds } },
          _sum: { totalAmount: true },
        })
      : []
    const spendMap = new Map(totals.map((t) => [t.customerId, t._sum.totalAmount ?? 0]))

    const customersWithTotals = customers.map((customer) => ({
      ...customer,
      totalPurchases: spendMap.get(customer.id) ?? 0,
    }))

    return NextResponse.json({ customers: customersWithTotals })
  } catch (error) {
    console.error('Customers list error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch customers' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  // Any authenticated staff may register customers (POS walk-in flow)
  const auth = await requireAuth(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await request.json()
    const { name, email, phone, address } = body

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json(
        { error: 'Customer name is required' },
        { status: 400 }
      )
    }

    const customer = await db.customer.create({
      data: {
        name: name.trim(),
        email: email || null,
        phone: phone || null,
        address: address || null,
      },
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'CREATE',
      entity: 'Customer',
      entityId: customer.id,
      details: `Registered customer "${customer.name}"`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(customer, { status: 201 })
  } catch (error) {
    console.error('Customer create error:', error)
    return NextResponse.json(
      { error: 'Failed to create customer' },
      { status: 500 }
    )
  }
}
