import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/require-auth'

// GET /api/audit-logs — admin-only audit trail with optional filtering
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || ''
    const entity = searchParams.get('entity') || ''
    const search = searchParams.get('search') || ''
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200)

    const where: Record<string, unknown> = {}
    if (action) where.action = action
    if (entity) where.entity = entity
    if (search) {
      // Search across details text and the linked user's name/email
      where.OR = [
        { details: { contains: search } },
        { user: { is: { name: { contains: search } } } },
        { user: { is: { email: { contains: search } } } },
      ]
    }

    const auditLogs = await db.auditLog.findMany({
      where,
      take: limit,
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ logs: auditLogs })
  } catch (error) {
    console.error('Audit logs list error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch audit logs' },
      { status: 500 }
    )
  }
}
