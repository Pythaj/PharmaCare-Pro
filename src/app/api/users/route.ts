import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/require-auth'
import { hashPassword } from '@/lib/auth'
import { logAudit, getClientIp } from '@/lib/audit'
import { parseEmail, parseName, parsePassword, parsePhone, parseRole, parseOptionalRole, parseActive, parseBranchForRole } from '@/lib/user-input'

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  phone: true,
  active: true,
  // Surfaced so the admin UI can show which accounts are still on a temporary
  // password instead of guessing from an absence of activity.
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
  // Home branch, so the admin UI can group staff by shop and show which
  // counter each salesperson works at.
  branchId: true,
} as const

// Branch details travel with the user so the admin table can render a name
// without an N+1 lookup per row.
const USER_WITH_BRANCH = {
  ...USER_SELECT,
  branch: { select: { id: true, name: true, code: true } },
} as const

// GET /api/users - list all users (admin only)
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const users = await db.user.findMany({
      select: USER_WITH_BRANCH,
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ users })
  } catch (error) {
    console.error('Users list error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    )
  }
}

// POST /api/users — create a user (admin only). Passwords are hashed at rest.
//
// The admin never learns the new account's real password, so the one they type
// is a TEMPORARY credential: mustChangePassword is set and the account is
// forced through first-time setup on its first sign-in. Without this flag the
// setup screen was unreachable and every account kept the password its creator
// chose — visible to anyone who could read the admin's screen or shoulder-surf.
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await request.json()
    const { phone } = body

    const name = parseName(body.name)
    if (!name.ok) {
      return NextResponse.json({ error: name.error }, { status: 400 })
    }

    const email = parseEmail(body.email)
    if (!email.ok) {
      return NextResponse.json({ error: email.error }, { status: 400 })
    }

    const password = parsePassword(body.password)
    if (!password.ok) {
      return NextResponse.json({ error: password.error }, { status: 400 })
    }

    const role = parseRole(body.role)
    if (!role.ok) {
      return NextResponse.json({ error: role.error }, { status: 400 })
    }

    const parsedPhone = parsePhone(phone)
    if (!parsedPhone.ok) {
      return NextResponse.json({ error: parsedPhone.error }, { status: 400 })
    }

    // Role and branch must agree: a salesperson needs a concrete branch, an
    // admin may be left on "all branches".
    const branch = parseBranchForRole(role.value, body.branchId)
    if (!branch.ok) {
      return NextResponse.json({ error: branch.error }, { status: 400 })
    }

    // Reject an unknown branch rather than letting the FK fail as a raw 500.
    if (branch.value) {
      const target = await db.branch.findUnique({
        where: { id: branch.value },
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

    // Emails are compared normalised, so "Ana@Pharmacy.com" cannot slip past
    // the uniqueness check by differing only in case.
    const existingUser = await db.user.findUnique({ where: { email: email.value } })
    if (existingUser) {
      return NextResponse.json(
        { error: 'A user with this email already exists' },
        { status: 409 }
      )
    }

    // SECURITY: never store plaintext passwords
    const hashedPassword = await hashPassword(password.value)

    const user = await db.user.create({
      data: {
        name: name.value,
        email: email.value,
        password: hashedPassword,
        role: role.value,
        phone: parsedPhone.value,
        branchId: branch.value,
        mustChangePassword: true,
      },
      select: USER_SELECT,
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'CREATE',
      entity: 'User',
      entityId: user.id,
      details: `Created ${user.role} account for ${user.email} (temporary password issued)`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(user, { status: 201 })
  } catch (error) {
    console.error('User create error:', error)
    return NextResponse.json(
      { error: 'Failed to create user' },
      { status: 500 }
    )
  }
}

// PUT /api/users — update a user by id in body (admin only)
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await request.json()
    const { id, name, email, role, phone, active, password } = body

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      )
    }

    const existing = await db.user.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Resolve role/active to real values FIRST, then make every guard below
    // compare the value that will actually be written. Comparing the raw body
    // let `role: ""` (which parseRole resolves to "sales") slip past the
    // lockout checks and demote the final administrator, and `active: "false"`
    // skip the self/last-admin guards and then fail inside Prisma with a 500.
    const parsedRole = parseOptionalRole(role)
    if (!parsedRole.ok) {
      return NextResponse.json({ error: parsedRole.error }, { status: 400 })
    }
    const nextRole = parsedRole.value ?? existing.role

    const parsedActive = parseActive(active)
    if (!parsedActive.ok) {
      return NextResponse.json({ error: parsedActive.error }, { status: 400 })
    }
    const nextActive = active === undefined || active === null || active === ''
      ? existing.active
      : parsedActive.value

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

    // Guard: never deactivate/demote the last active admin (prevents lockout)
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

    if (name !== undefined) {
      const parsed = parseName(name)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      updateData.name = parsed.value
    }

    if (email !== undefined) {
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

    if (role !== undefined) {
      if (parsedRole.value !== undefined && parsedRole.value !== existing.role) {
        updateData.role = parsedRole.value
      }
    }

    // Branch assignment. Validate against the role that will actually be
    // stored (not the raw body) so a role change and a branch change made in
    // the same request cannot contradict each other.
    if (body.branchId !== undefined) {
      const effectiveRole = (updateData.role as string | undefined) ?? existing.role
      const parsed = parseBranchForRole(effectiveRole, body.branchId)
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

    // A demotion to sales must not leave the account branchless — that would
    // give a former owner a "sales" account with no till, or (worse) a null
    // branch that a scope filter reads as all-branches.
    const finalRole = (updateData.role as string | undefined) ?? existing.role
    const finalBranch =
      'branchId' in updateData ? (updateData.branchId as string | null) : existing.branchId
    if (finalRole !== 'admin' && !finalBranch) {
      return NextResponse.json(
        { error: 'A sales account must be assigned to a branch' },
        { status: 400 }
      )
    }

    if (phone !== undefined) {
      const parsed = parsePhone(phone)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      updateData.phone = parsed.value
    }

    if (active !== undefined && nextActive !== existing.active) {
      updateData.active = nextActive
    }

    if (password !== undefined && password !== null && password !== '') {
      const parsed = parsePassword(password)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      // SECURITY: hash on update as well
      updateData.password = await hashPassword(parsed.value)
      // A reset password is temporary by definition — force setup so the
      // admin-chosen value does not survive as the account's real password.
      updateData.mustChangePassword = true
    }

    const updated = await db.user.update({
      where: { id },
      data: updateData,
      select: USER_SELECT,
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'UPDATE',
      entity: 'User',
      entityId: updated.id,
      details: `Updated account ${updated.email}${updateData.password ? ' (password reset — setup required)' : ''}`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('User update error:', error)
    return NextResponse.json(
      { error: 'Failed to update user' },
      { status: 500 }
    )
  }
}
