import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/require-auth'
import { hashPassword } from '@/lib/auth'
import { logAudit, getClientIp } from '@/lib/audit'

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  phone: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const

// GET /api/users — list all users (admin only)
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const users = await db.user.findMany({
      select: USER_SELECT,
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
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await request.json()
    const { name, email, password, role, phone } = body

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Name, email, and password are required' },
        { status: 400 }
      )
    }

    if (typeof password !== 'string' || password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 }
      )
    }

    const validRoles = ['admin', 'sales']
    if (role && !validRoles.includes(role)) {
      return NextResponse.json(
        { error: 'Role must be either "admin" or "sales"' },
        { status: 400 }
      )
    }

    const existingUser = await db.user.findUnique({ where: { email } })
    if (existingUser) {
      return NextResponse.json(
        { error: 'A user with this email already exists' },
        { status: 409 }
      )
    }

    // SECURITY: never store plaintext passwords
    const hashedPassword = await hashPassword(password)

    const user = await db.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: role || 'sales',
        phone: phone || null,
      },
      select: USER_SELECT,
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'CREATE',
      entity: 'User',
      entityId: user.id,
      details: `Created ${user.role} account for ${user.email}`,
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

    if (!id) {
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

    // Guard: never deactivate/demote the last active admin (prevents lockout)
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
    if (name !== undefined) updateData.name = name
    if (email !== undefined) updateData.email = email
    if (role !== undefined) updateData.role = role
    if (phone !== undefined) updateData.phone = phone
    if (active !== undefined) updateData.active = active
    if (password !== undefined) {
      if (typeof password !== 'string' || password.length < 6) {
        return NextResponse.json(
          { error: 'Password must be at least 6 characters' },
          { status: 400 }
        )
      }
      // SECURITY: hash on update as well
      updateData.password = await hashPassword(password)
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
      details: `Updated account ${updated.email}${password ? ' (password reset)' : ''}`,
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
