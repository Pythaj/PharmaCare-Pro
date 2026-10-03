import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { findOrCreateDailyRecord } from '@/lib/daily-sales'
import { toNumber } from '@/lib/utils'
import { ValidationError, parseErrorResponse } from '@/lib/api-error'
import { requireBranchForWrite } from '@/lib/branches'

/** Default records per page, and the hard ceiling on a client-supplied limit. */
const DEFAULT_PAGE_SIZE = 30
const MAX_PAGE_SIZE = 200

/**
 * 1-based page and a clamped page size.
 *
 * `parseInt` returns `NaN` for junk and the raw value for anything else, and both
 * used to reach Prisma: `NaN` threw a 500 on a bad query string, and an
 * unbounded `limit` let one request read the whole table of daily registers.
 */
function parsePaging(params: URLSearchParams): { page: number; limit: number } {
  const rawPage = Number.parseInt(params.get('page') ?? '', 10);
  const rawLimit = Number.parseInt(params.get('limit') ?? '', 10);

  const page = Number.isFinite(rawPage) ? Math.max(rawPage, 1) : 1;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;

  return { page, limit };
}

/**
 * A register is addressed by one real local day.
 *
 * `date` used to be written straight into the row, so `{"date":"not-a-date"}`
 * created a register that no day query would ever return — an invisible record
 * that still occupied the one-per-branch-per-day slot for nothing.
 */
function parseRegisterDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new ValidationError('Date is required and must use the YYYY-MM-DD format');
  }

  const date = value.trim();
  // Reject impossible calendar dates (2026-02-30), which the regex allows.
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    throw new ValidationError('Invalid date');
  }

  return date;
}

// GET /api/daily-sales — list all daily records (paginated, with summary)
export async function GET(request: NextRequest) {
  const auth = await requireBranchScope(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(request.url)
    const { page, limit } = parsePaging(searchParams)
    const status = searchParams.get('status') || '' // 'open' or 'closed'

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    // Exact-day lookup. A register is unique per (date, branch), so asking for a
    // day returns at most one row per branch.
    //
    // This exists because callers that need ONE specific day used to fetch a page
    // and scan it: `SalesHistoryView` asked for `limit=1` and then searched that
    // single record for yesterday, so the "vs previous day" comparison silently
    // never rendered — the one record it received was today's. Querying the day
    // directly is also correct when days are missing: if no register was opened
    // for the previous calendar day there is genuinely nothing to compare
    // against, and this reports that instead of comparing against whatever day
    // happened to sort first.
    //
    // Still session-scoped on branch, so `date` narrows and never widens.
    const dateParam = searchParams.get('date')
    if (dateParam) where.date = parseRegisterDate(dateParam)
    // Branch scoping comes from the session, never the query string, so a
    // cashier cannot widen it by editing a URL.
    if (auth.scope!.branchId) where.branchId = auth.scope!.branchId

    const [records, total] = await Promise.all([
      db.dailySalesRecord.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true, code: true } },
          opener: { select: { id: true, name: true } },
          closer: { select: { id: true, name: true } },
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.dailySalesRecord.count({ where }),
    ])

    return NextResponse.json({
records: records.map((r) => ({
        ...r,
        totalRevenue: toNumber(r.totalRevenue),
        totalProfit: toNumber(r.totalProfit),
        cashTotal: toNumber(r.cashTotal),
        cardTotal: toNumber(r.cardTotal),
        mobileMoneyTotal: toNumber(r.mobileMoneyTotal),
      })),
      total, page, limit,
    })
  } catch (error) {
    console.error('Daily sales list error:', error)
    return NextResponse.json({ error: 'Failed to fetch daily sales records' }, { status: 500 })
  }
}

// POST /api/daily-sales — open a new daily record for a given date
export async function POST(request: NextRequest) {
  // Authenticated staff only; the opener identity comes from the JWT cookie
  const auth = await requireBranchScope(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await request.json()
    const date = parseRegisterDate(body?.date)

    // A till belongs to exactly one branch, so opening one requires a specific
    // branch. "All branches" is a read-only view — you cannot open a register
    // that has no single owner.
    const branchId = requireBranchForWrite(
      auth.scope!,
      'Select a branch before opening the daily register'
    )

    const validUserId = auth.user!.userId

    // One register per branch per day, opened or refreshed atomically enough to
    // survive two operators pressing the same button at once.
    const { created } = await findOrCreateDailyRecord(date, branchId, validUserId)

    const record = await db.dailySalesRecord.findFirst({
      where: { date, branchId },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        opener: { select: { id: true, name: true } },
        closer: { select: { id: true, name: true } },
      },
    })

    // 200 rather than 201 when the register was already there: the caller's
    // request did not create anything.
    return NextResponse.json(record, { status: created ? 201 : 200 })
  } catch (error) {
    console.error('Create daily sales record error:', error)
    const mapped = parseErrorResponse(error, 'Failed to create daily sales record')
    if (mapped) return mapped
    return NextResponse.json({ error: 'Failed to create daily sales record' }, { status: 500 })
  }
}
