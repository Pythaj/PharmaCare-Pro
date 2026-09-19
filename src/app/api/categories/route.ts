import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, requireAdmin } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const categories = await db.category.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    })
    return NextResponse.json({ categories })
  } catch (error) {
    console.error('Categories fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await request.json()
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const description = typeof body.description === 'string' ? body.description.trim() : ''

    if (!name) {
      return NextResponse.json(
        { error: 'Category name is required' },
        { status: 400 }
      )
    }

    const existing = await db.category.findFirst({ where: { name } })
    if (existing) {
      return NextResponse.json(
        { error: `Category "${name}" already exists` },
        { status: 409 }
      )
    }

    const category = await db.category.create({
      data: { name, description: description || null },
      include: { _count: { select: { products: true } } },
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'CREATE',
      entity: 'Category',
      entityId: category.id,
      details: `Created category "${category.name}"`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(category, { status: 201 })
  } catch (error) {
    console.error('Category create error:', error)
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 })
  }
}
