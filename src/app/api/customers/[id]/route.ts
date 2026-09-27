import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, requireAuth } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'
import {
  parseCustomerName,
  parseOptionalCustomerEmail,
  parseOptionalCustomerPhone,
  parseOptionalCustomerAddress,
} from '@/lib/customer-input'

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
    const customer = await db.customer.findUnique({
      where: { id },
      include: {
        _count: { select: { sales: true } },
      },
    })
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    const sales = await db.sale.findMany({
      where: { customerId: id },
      select: {
        invoiceNo: true,
        totalAmount: true,
        profit: true,
        paymentMethod: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    const totalPurchases = await db.sale.aggregate({
      where: { customerId: id },
      _sum: { totalAmount: true },
    })

    return NextResponse.json({
      ...customer,
      totalPurchases: totalPurchases._sum.totalAmount ?? 0,
      sales,
    })
  } catch (error) {
    console.error('Customer fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch customer' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    // Admin-only mutation — identity from HttpOnly JWT cookie
    const auth = await requireAdmin(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    const body = await request.json()
    const { name, email, phone, address } = body

    const existing = await db.customer.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    // Same validators as POST /api/customers. This handler used to copy the
    // request body straight into Prisma, so a non-string field produced a raw
    // 500 and a blank name was accepted.
    const updateData: Record<string, unknown> = {}

    if (name !== undefined) {
      const parsed = parseCustomerName(name)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      updateData.name = parsed.value
    }

    if (email !== undefined) {
      const parsed = parseOptionalCustomerEmail(email)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      updateData.email = parsed.value
    }

    if (phone !== undefined) {
      const parsed = parseOptionalCustomerPhone(phone)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      updateData.phone = parsed.value
    }

    if (address !== undefined) {
      const parsed = parseOptionalCustomerAddress(address)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      updateData.address = parsed.value
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const updated = await db.customer.update({
      where: { id },
      data: updateData,
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'UPDATE',
      entity: 'Customer',
      entityId: id,
      details: `Updated customer "${updated.name}"`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Customer update error:', error)
    return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    // Admin-only mutation — identity from HttpOnly JWT cookie
    const auth = await requireAdmin(request)
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const existing = await db.customer.findUnique({
      where: { id },
      include: { _count: { select: { sales: true } } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    if (existing._count.sales > 0) {
      return NextResponse.json(
        { error: 'Cannot delete customer with existing sales records' },
        { status: 400 }
      )
    }

    await db.customer.delete({ where: { id } })

    await logAudit({
      userId: auth.user!.userId,
      action: 'DELETE',
      entity: 'Customer',
      entityId: id,
      details: `Deleted customer "${existing.name}"`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ message: 'Customer deleted successfully' })
  } catch (error) {
    console.error('Customer delete error:', error)
    return NextResponse.json({ error: 'Failed to delete customer' }, { status: 500 })
  }
}