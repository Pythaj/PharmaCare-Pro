import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { active, password, name, phone, role, email } = body

    const existing = await db.user.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}
    if (active !== undefined) updateData.active = active
    if (password) updateData.password = password
    if (name) updateData.name = name
    if (phone !== undefined) updateData.phone = phone
    if (role) updateData.role = role
    if (email) updateData.email = email

    const user = await db.user.update({
      where: { id },
      data: updateData,
      select: { id: true, name: true, email: true, role: true, phone: true, active: true },
    })

    return NextResponse.json(user)
  } catch (error) {
    console.error('User update error:', error)
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  }
}