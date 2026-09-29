import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/require-auth'
import { hashPassword } from '@/lib/auth'
import { logAudit, getClientIp } from '@/lib/audit'
import { parseEmail, parseName, parsePassword, parsePhone, parseOptionalRole, parseOptionalActive, parseBranchId, parseBranchForRole } from '@/lib/user-input'

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  phone: true,
  active: true,
  mustChangePassword: true,
  branchId: true,
  branch: { select: { id: true, name: true, code: true } },
} as const

// PATCH /api/users/[id] — partial update (admin only). Passwords hashed at rest.
//
// Uses the same validators as POST/PUT /api/users: a partial update used to
// skip the password-length and email-uniqueness checks entirely, so a bad reset
// or a duplicate address surfaced as a raw Prisma 500 instead of a message.
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
    const { active, password, name, phone, role, email, branchId } = body

    const existing = await db.user.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Parse role/active before the guards so the guards see the values that
    // will actually be written (see the same note in PUT /api/users).
    const parsedRole = parseOptionalRole(role)
    if (!parsedRole.ok) {
      return NextResponse.json({ error: parsedRole.error }, { status: 400 })
    }
    const nextRole = parsedRole.value ?? existing.role

    const parsedActive = parseOptionalActive(active)
    if (!parsedActive.ok) {
      return NextResponse.json({ error: parsedActive.error }, { status: 400 })
    }
    const nextActive = parsedActive.value ?? existing.active

    // Guard: an admin cannot deactivate or demote their own account
    if (id === auth.user!.userId) {
      if (!nextActive) {
        return NextResponse.json(
          { error: 'You cannot deactivate your own account' },
          { status: 400 }
        )
      }
      if (nextRole !== 'admin') {
        return NextResponse.json(
          { error: 'You cannot change your own role' },
          { status: 400 }
        )
      }
    }

    // Guard: never remove the last active administrator (prevents lockout)
    if (existing.role === 'admin' && existing.active && (nextRole !== 'admin' || !nextActive)) {
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

    if (parsedActive.value !== undefined && parsedActive.value !== existing.active) {
      updateData.active = parsedActive.value
    }

    if (name !== undefined) {
      const parsed = parseName(name)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      updateData.name = parsed.value
    }

    if (phone !== undefined) {
      const parsed = parsePhone(phone)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      updateData.phone = parsed.value
    }

    if (parsedRole.value !== undefined && parsedRole.value !== existing.role) {
      updateData.role = parsedRole.value
    }

    // Branch assignment. Accepted on PATCH for parity with PUT /api/users, and
    // without it there is no single-account way to repair a branchless user:
    // the only route that could set branchId was the bulk one.
    //
    // The target branch is checked for existence and activeness before it is
    // written, matching PUT — assigning staff to a deactivated branch would
    // strand them the moment that branch is switched off.
    if (branchId !== undefined) {
      const parsed = parseBranchId(branchId)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      if (parsed.value !== existing.branchId) {
        if (parsed.value) {
          const target = await db.branch.findUnique({
            where: { id: parsed.value },
            select: { id: true, active: true },
          })
          if (!target) {
            return NextResponse.json({ error: 'Branch not found' }, { status: 400 })
          }
          if (!target.active) {
            return NextResponse.json(
              { error: 'Staff cannot be assigned to an inactive branch' },
              { status: 400 }
            )
          }
        }
        updateData.branchId = parsed.value
      }
    }

    // The role/branch invariant, checked against the state that will actually be
    // STORED rather than the raw request body — otherwise a role change and a
    // branch change sent together (or a bare role change on an account that
    // already has no branch) slip past.
    //
    // This handler previously had no such guard while the bulk PUT did, so
    // demoting an admin to `sales` through this route produced an account that
    // 403s on every branch-scoped endpoint: `resolveScope` throws
    // BranchConfigurationError for a salesperson with no branch. Worse, the
    // account was unrepairable from this route, because branchId was not
    // accepted here at all.
    //
    // `parseBranchForRole` is the same function PUT uses, so the rule now has
    // one implementation instead of two that could drift.
    const finalRole = (updateData.role as string | undefined) ?? existing.role
    const finalBranch = 'branchId' in updateData
      ? (updateData.branchId as string | null)
      : existing.branchId
    const branchInvariant = parseBranchForRole(finalRole, finalBranch)
    if (!branchInvariant.ok) {
      return NextResponse.json({ error: branchInvariant.error }, { status: 400 })
    }

    if (email !== undefined && email !== null && email !== '') {
      const parsed = parseEmail(email)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      if (parsed.value !== existing.email) {
        const taken = await db.user.findUnique({ where: { email: parsed.value } })
        if (taken) {
          return NextResponse.json(
            { error: 'A user with this email already exists' },
            { status: 409 }
          )
        }
      }
      updateData.email = parsed.value
    }

    if (password !== undefined && password !== null && password !== '') {
      const parsed = parsePassword(password)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      updateData.password = await hashPassword(parsed.value)
      // A reset password is temporary: make the account complete setup again.
      updateData.mustChangePassword = true
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const user = await db.user.update({
      where: { id },
      data: updateData,
      select: USER_SELECT,
    })

    // Spell out role and branch changes in the audit text. The schema's own
    // comment on AuditLog.branchId says these logs exist so a dispute ("who
    // moved this account to the new branch?") can be settled from the trail
    // alone — an entry reading only "Updated account a@b.com" cannot answer it.
    const changes: string[] = []
    if (updateData.password) changes.push('password reset — setup required')
    if (updateData.role !== undefined) changes.push(`role → ${updateData.role}`)
    if ('branchId' in updateData) {
      changes.push(
        updateData.branchId
          ? `branch → ${user.branch?.name ?? updateData.branchId}`
          : 'branch → all branches'
      )
    }
    if (updateData.active !== undefined) {
      changes.push(updateData.active ? 'account re-enabled' : 'account disabled')
    }

    await logAudit({
      userId: auth.user!.userId,
      branchId: user.branchId,
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      details: `Updated account ${user.email}${changes.length ? ` (${changes.join(', ')})` : ''}`,
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
      await tx.return.updateMany({ where: { userId: id }, data: { userId: null } })
      await tx.dailySalesRecord.updateMany({ where: { openedBy: id }, data: { openedBy: null } })
      await tx.dailySalesRecord.updateMany({ where: { closedBy: id }, data: { closedBy: null } })
      // Audit rows are PRESERVED, not deleted. AuditLog.user is an optional
      // relation, so Prisma nulls userId on delete and the trail survives with
      // the actor shown as unknown. Erasing these rows used to let a user
      // remove the evidence of what they did — including the creation and edits
      // of the very account being deleted.
      await tx.user.delete({ where: { id } })
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'DELETE',
      entity: 'User',
      entityId: id,
      details: `Deleted account ${user.email} (${user.role}) — audit history retained`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ message: 'User deleted successfully' })
  } catch (error) {
    console.error('User delete error:', error)
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }
}
