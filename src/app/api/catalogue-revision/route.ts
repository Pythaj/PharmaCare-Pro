import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'

/**
 * GET /api/catalogue-revision — a cheap "has the catalogue changed?" token.
 *
 * WHY THIS EXISTS
 *
 * A till at Branch B has to reflect an admin's price change at Branch A
 * "right away", but the two are different browsers on different devices, so no
 * in-page event or BroadcastChannel can reach between them. The old answer was a
 * blind 30-second refetch of the entire catalogue: correct eventually, but the
 * owner sees a stale price for up to half a minute after changing it, and every
 * till on the floor pays for a full product list on a timer.
 *
 * This endpoint splits the two concerns:
 *   - a SMALL token that changes the instant the catalogue does, polled often;
 *   - the full `/api/products` payload, fetched only when the token moved.
 *
 * Same-device tabs do not use this at all — they invalidate instantly via
 * BroadcastChannel (see src/lib/catalogue-events.ts). This is the cross-device
 * path.
 *
 * WHY A DERIVED TOKEN AND NOT A STORED COUNTER
 *
 * A `catalogueVersion` row bumped on every write would be the obvious design,
 * but it needs an extra write on every product, import, sale and transfer, and
 * any write path that forgets to bump it makes clients serve stale data
 * forever. Deriving the token from rows that are already being written means
 * there is nothing to keep in sync: a change to a product or a batch necessarily
 * changes the token, because the row it changed is the row being read.
 *
 * WHAT IS INCLUDED, AND WHY IT IS EXACTLY THIS
 *
 *   products.max(updatedAt) - a rename, a category fix, a price edit, or the
 *     product appearing/disappearing (new products are the newest row, and a
 *     count change moves the token too).
 *   products.count         - catches a create+delete pair landing inside one
 *     millisecond, where the max timestamp is unchanged.
 *   batches.max(updatedAt) - a batch's price or quantity changing WITHOUT the
 *     product row changing: receiving a transfer, or an Edit Drug that restocks
 *     a batch in place. This is the reason the token reads batches as well.
 *
 * Deliberately NOT included: sales, purchases, returns, users, settings. Those
 * are not part of the catalogue a till renders, and including them would make
 * every sale invalidate every till's product list.
 */
export async function GET(request: NextRequest) {
  const auth = await requireBranchScope(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const [productAgg, batchAgg] = await Promise.all([
      db.product.aggregate({
        _max: { updatedAt: true },
        _count: { _all: true },
      }),
      db.batch.aggregate({
        _max: { updatedAt: true },
      }),
    ])

    // Epoch millis, or 0 when the table is empty. Counted into the token so an
    // empty table and a populated one never collide.
    const revision = [
      productAgg._count._all,
      productAgg._max.updatedAt?.getTime() ?? 0,
      batchAgg._max.updatedAt?.getTime() ?? 0,
    ].join(':')

    // Clients poll this repeatedly, so it must never be cached by the browser,
    // a proxy or the CDN — a cached token would hide the very change it exists
    // to reveal.
    return NextResponse.json(
      { revision },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    )
  } catch (error) {
    console.error('Catalogue revision error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch catalogue revision' },
      { status: 500 }
    )
  }
}
