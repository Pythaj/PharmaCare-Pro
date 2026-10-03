import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { branchWhere } from '@/lib/branches'
import { getExpiryAlertDays } from '@/lib/server-settings'
import { computeAlertCounts } from '@/lib/stock-alert-counts'

/**
 * GET /api/dashboard/alerts-count
 *
 * Two integers for the header bell: how many products are low and how many
 * batches are expiring. Nothing else.
 *
 * This exists because the bell used to poll `/api/dashboard/stats`, which is the
 * entire dashboard — revenue and profit aggregates, refund money, and every
 * in-stock batch pulled into memory to value the shelf. Recomputing all of that
 * every minute on every page, to render a badge, is a lot of database for two
 * numbers; and on the admin dashboard `AdminDashboard` is already polling that
 * same endpoint every 30 seconds, so it was being computed twice and one copy
 * discarded.
 *
 * The counting rule itself is shared with the dashboard (`computeAlertCounts`),
 * because two copies of "what counts as low stock" is how the bell and the tile
 * end up disagreeing after only one of them is edited.
 */
export async function GET(request: NextRequest) {
  const auth = await requireBranchScope(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const now = new Date()
    // Same setting the dashboard reads, so both warn about the same batches.
    const expiryWarningDays = await getExpiryAlertDays()
    const expiryHorizon = new Date(now.getTime() + expiryWarningDays * 24 * 60 * 60 * 1000)

    // Stock is branch-scoped: a batch on another branch's shelf cannot be sold
    // from this till, so counting it would overstate availability here.
    const counts = await computeAlertCounts(db, {
      stockWhere: branchWhere(auth.scope!),
      branchId: auth.scope!.branchId ?? null,
      expiryHorizon,
      now,
    })

    return NextResponse.json({
      // Echoed so the badge can never silently mean a different boundary than
      // the page it is sitting on top of.
      scope: auth.user!.role === 'admin' ? (auth.scope!.branchId ? 'branch' : 'all') : 'own',
      branchId: auth.scope!.branchId ?? null,
      ...counts,
      alertCount: counts.lowStockCount + counts.expiringCount,
    })
  } catch (error) {
    console.error('Dashboard alert count error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch alert counts' },
      { status: 500 }
    )
  }
}