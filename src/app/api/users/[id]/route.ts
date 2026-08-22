import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/require-auth'
import { hashPassword } from '@/lib/auth'
import { logAudit, getClientIp } from '@/lib/audit'

// PATCH /api/users/[id] — partial update (admin only). Passwords hashed at rest.
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
    const { active, password, name, phone, role, email } = body

    const existing = await db.user.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Guard: an admin cannot deactivate or demote their own account
    if (id === auth.user!.userId) {
      if (active === false) {
        return NextResponse.json(
          { error: 'You cannot deactivate your own account' },
          { status: 400 }
        )
      }
      if (role && role !== 'admin') {
        return NextResponse.json(
          { error: 'You cannot change your own role' },
          { status: 400 }
        )
      }
    }

    // Guard: never remove the last active administrator (prevents lockout)
    if (
      existing.role === 'admin' &&
      existing.active &&
      ((active === false) || (role && role !== 'admin'))
    ) {
      const activeAdmins = await db.user.count({
        where: { role: 'admin', active: true, NOT: { id } },
      })
      if (activeAdmins === 0) {
        return NextResponse.json(
          { error: 'Cannot remove the last active administrator' },
          { status: 400 }
        )
      }
    }

    const updateData: Record<string, unknown> = {}
    if (active !== undefined) updateData.active = active
    if (password) updateData.password = await hashPassword(password)
    if (name) updateData.name = name
    if (phone !== undefined) updateData.phone = phone
    if (role) updateData.role = role
    if (email) updateData.email = email

    const user = await db.user.update({
      where: { id },
      data: updateData,
      select: { id: true, name: true, email: true, role: true, phone: true, active: true },
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      details: `Updated account ${user.email}${password ? ' (password reset)' : ''}`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(user)
  } catch (error) {
    console.error('User update error:', error)
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  }
}

// DELETE /api/users/[id] — hard delete with reference cleanup (admin only)
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

    // Guard: an admin cannot delete their own account
    if (id === auth.user!.userId) {
      return NextResponse.json(
        { error: 'You cannot delete your own account' },
        { status: 400 }
      )
    }

    const user = await db.user.findUnique({ where: { id } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Guard: never delete the last active admin
    if (user.role === 'admin' && user.active) {
      const activeAdmins = await db.user.count({
        where: { role: 'admin', active: true, NOT: { id } },
      })
      if (activeAdmins === 0) {
        return NextResponse.json(
          { error: 'Cannot delete the last active administrator' },
          { status: 400 }
        )
      }
    }

    // Null out FK references so we can safely delete the user.
    // Wrapped in a transaction so partial cleanup can never orphan records.
    await db.$transaction(async (tx) => {
      await tx.sale.updateMany({ where: { userId: id }, data: { userId: null } })
      await tx.purchase.updateMany({ where: { userId: id }, data: { userId: null } })
      await tx.dailySalesRecord.updateMany({ where: { openedBy: id }, data: { openedBy: null } })
      await tx.dailySalesRecord.updateMany({ where: { closedBy: id }, data: { closedBy: null } })
      await tx.auditLog.deleteMany({ where: { userId: id } })
      await tx.user.delete({ where: { id } })
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'DELETE',
      entity: 'User',
      entityId: id,
      details: `Deleted account ${user.email} (${user.role})`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ message: 'User deleted successfully' })
  } catch (error) {
    console.error('User delete error:', error)
    const message = error instanceof Error ? error.message : 'Failed to delete user'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
