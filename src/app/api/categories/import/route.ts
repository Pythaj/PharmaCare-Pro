import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'

interface ImportRow {
  name: string
  description?: string
}

const MAX_ROWS = 5000

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const items: ImportRow[] = Array.isArray(body.items) ? body.items : []
    const onDuplicate = body.onDuplicate === 'update' ? 'update' : 'skip'

    if (items.length === 0) {
      return NextResponse.json(
        { error: 'No items provided. Expected { items: [{ name, description }] }.' },
        { status: 400 }
      )
    }
    if (items.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `Too many rows (${items.length}). Maximum is ${MAX_ROWS} per import.` },
        { status: 400 }
      )
    }

    const result = await db.$transaction(async (tx) => {
      const counts = { created: 0, updated: 0, skipped: 0 }
      const errors: { row: number; name: string; message: string }[] = []

      items.forEach((row, index) => {
        const name = typeof row.name === 'string' ? row.name.trim() : ''
        if (!name) {
          errors.push({ row: index + 1, name: '', message: 'Category name is required' })
          return
        }
      })

      for (let i = 0; i < items.length; i++) {
        const row = items[i]
        const name = typeof row.name === 'string' ? row.name.trim() : ''
        const description = typeof row.description === 'string' ? row.description.trim() : undefined

        if (!name) continue // already recorded — skip processing

        try {
          if (onDuplicate === 'update') {
            const existing = await tx.category.findFirst({ where: { name } })
            if (existing) {
              await tx.category.update({
                where: { id: existing.id },
                data: { description: description || existing.description },
              })
              counts.updated += 1
              return
            }
          } else {
            const existing = await tx.category.findFirst({ where: { name } })
            if (existing) {
              counts.skipped += 1
              return
            }
          }
          await tx.category.create({ data: { name, description: description || null } })
          counts.created += 1
        } catch (err) {
          console.error(`Category import row ${i + 1} failed:`, err)
          errors.push({
            row: i + 1,
            name,
            message: err instanceof Error ? err.message : 'Unknown error',
          })
        }
      }

      return { ...counts, errors }
    })

    if (!result) {
      throw new Error('Import transaction produced no result')
    }

    await logAudit({
      userId: auth.user!.userId,
      action: 'CREATE',
      entity: 'Category',
      details: `Bulk import: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped (${result.errors.length} errors)`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors.slice(0, 50),
      total: items.length,
    })
  } catch (error) {
    console.error('Category bulk import error:', error)
    return NextResponse.json({ error: 'Failed to import categories' }, { status: 500 })
  }
}