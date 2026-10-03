import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, requireBranchScope } from '@/lib/require-auth'
import { branchWhere } from '@/lib/branches'
import { logAudit, getClientIp } from '@/lib/audit'
import {
  parseCustomerName,
  parseOptionalCustomerEmail,
  parseOptionalCustomerPhone,
  parseOptionalCustomerAddress,
} from '@/lib/customer-input'

export async function GET(request: NextRequest) {
  // Branch scope, not just identity. A Customer is a chain-wide record with no
  // branch of its own, so "whose customers are these" is answered entirely by the
  // SALES hanging off them. Using requireAuth here therefore leaked every shop's
  // takings to every cashier: the sale count and the spend total below were both
  // unfiltered reads of `Sale`, so a salesperson at Branch B saw Branch A's
  // revenue per customer. The fix is to scope the Sale relation, not the parent
  // row — `branchWhere` supplies `{}` only for an admin deliberately viewing the
  // whole business.
  const auth = await requireBranchScope(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''

    const saleScope = branchWhere(auth.scope!)

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
        // Filtered count: the unfiltered `_count: { sales: true }` counted every
        // branch's receipts, so the column shown next to each name was the
        // business total presented as though it were this branch's.
        _count: { select: { sales: { where: saleScope } } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Attach each customer's total spend so the list can show real purchase
    // totals without making a query per row (matches GET /api/customers/[id]).
    const customerIds = customers.map((c) => c.id)
    const totals = customerIds.length > 0
      ? await db.sale.groupBy({
          by: ['customerId'],
          where: { customerId: { in: customerIds }, ...saleScope },
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

    const parsedName = parseCustomerName(name)
    if (!parsedName.ok) {
      return NextResponse.json({ error: parsedName.error }, { status: 400 })
    }

    const parsedEmail = parseOptionalCustomerEmail(email)
    if (!parsedEmail.ok) {
      return NextResponse.json({ error: parsedEmail.error }, { status: 400 })
    }

    const parsedPhone = parseOptionalCustomerPhone(phone)
    if (!parsedPhone.ok) {
      return NextResponse.json({ error: parsedPhone.error }, { status: 400 })
    }

    const parsedAddress = parseOptionalCustomerAddress(address)
    if (!parsedAddress.ok) {
      return NextResponse.json({ error: parsedAddress.error }, { status: 400 })
    }

    const customer = await db.customer.create({
      data: {
        name: parsedName.value,
        email: parsedEmail.value,
        phone: parsedPhone.value,
        address: parsedAddress.value,
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
