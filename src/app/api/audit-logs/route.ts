import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '@/lib/audit-actions'
import { branchWhere } from '@/lib/branches'

// GET /api/audit-logs — admin-only audit trail with optional filtering
//
// `action` and `entity` are validated against the canonical vocabulary. An
// unrecognised value used to be passed straight into the where clause, so a
// typo (or a stale filter left over from the old vocabulary) answered with a
// confidently empty list instead of telling the caller the filter is wrong.
export async function GET(request: NextRequest) {
  const auth = await requireBranchScope(request, { admin: true })
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || ''
    const entity = searchParams.get('entity') || ''
    const search = searchParams.get('search') || ''
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200)

    if (action && !(AUDIT_ACTIONS as readonly string[]).includes(action)) {
      return NextResponse.json(
        { error: `Unknown action "${action}"` },
        { status: 400 }
      )
    }
    if (entity && !(AUDIT_ENTITIES as readonly string[]).includes(entity)) {
      return NextResponse.json(
        { error: `Unknown entity "${entity}"` },
        { status: 400 }
      )
    }

    // Branch first, so the other filters can only narrow within it. Company-wide
    // entries (branchId = null — a branch being created, settings changed) belong
    // to no shop and are therefore visible only on the consolidated "All
    // branches" view. That is deliberate: mixing them into every branch's trail
    // would put actions nobody took at that shop into its history.
    const where: Record<string, unknown> = branchWhere(auth.scope!)
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
        branch: {
          select: { id: true, name: true, code: true },
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
