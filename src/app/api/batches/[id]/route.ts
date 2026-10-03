import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { requireBranchForWrite } from '@/lib/branches'
import { logAudit, getClientIp } from '@/lib/audit'
import { parseErrorResponse, branchMissResponse, idExists } from '@/lib/api-error'

/**
 * A Batch row IS a shelf: its quantity is that branch's on-hand stock of one
 * expiry, and its cost is what that branch's profit is measured against. Both
 * handlers below therefore have to respect the active branch, not just the
 * admin role. "Admin" answers WHO may act; it does not answer WHOSE BOOKS. An
 * admin working Branch A must not be able to rewrite Branch B's stock levels or
 * cost prices from that branch's screen.
 *
 * ## Why these two handlers now REQUIRE a branch
 *
 * The ownership test used to be `if (scope.branchId && batch.branchId !== scope.branchId)`.
 * On the consolidated "All branches" view `scope.branchId` is null, so the whole
 * condition short-circuited to false and the check was SKIPPED — an admin
 * deliberately viewing the whole business could rewrite or delete any branch's
 * stock by id. That reads as harmless until you notice the product list merges
 * every branch's batches into one table with no branch column: the admin could
 * not tell whose shelf a row belonged to, and "delete" removed real stock from a
 * shop they had not selected.
 *
 * Editing a batch is a stock WRITE, and stock belongs to exactly one branch —
 * the same rule `POST /api/batches` has always enforced via `requireBranchForWrite`.
 * It is applied here so the consolidated view is genuinely read-only for stock,
 * matching `settings/branch-reset`, which already refuses it. Select the branch
 * whose shelf you are correcting and the same request succeeds.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireBranchScope(request, { admin: true })
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params
    const body = await request.json()

    // Stock writes need one branch. Throws (rendered as a 400 by the catch below)
    // on the consolidated view rather than falling through to an unscoped write.
    const branchId = requireBranchForWrite(
      auth.scope!,
      'Select the branch whose stock you are correcting first — a batch belongs to one branch\'s shelf'
    )

    // Scoped in the QUERY, not by a post-fetch comparison. Fetching by id and
    // then testing `batch.branchId` in JS is the same ownership check one line
    // away from being forgotten; putting it in the `where` makes it impossible
    // to write the row and only then discover it was the wrong branch's.
    const batch = await db.batch.findFirst({
      where: { id, branchId },
    })
    if (!batch) {
      // 403 vs 404 is part of the contract, so the miss has to be classified.
      return branchMissResponse(
        await idExists(db.batch, { id }),
        'Batch not found',
        'That batch belongs to a different branch'
      )
    }

    const quantity = body.quantity !== undefined ? Number(body.quantity) : batch.quantity
    if (!Number.isFinite(quantity) || quantity < 0) {
      return NextResponse.json({ error: 'Quantity must be zero or more' }, { status: 400 })
    }

    const updated = await db.batch.update({
      where: { id },
      data: {
        // Empty batchNumber/expiry preserve the existing values — they must
        // never block saving a drug entry.
        batchNumber:
          typeof body.batchNumber === 'string' && body.batchNumber.trim()
            ? body.batchNumber.trim()
            : batch.batchNumber,
        quantity,
        costPrice: body.costPrice !== undefined ? Number(body.costPrice) : batch.costPrice,
        sellingPrice: body.sellingPrice !== undefined ? Number(body.sellingPrice) : batch.sellingPrice,
        expiryDate:
          typeof body.expiryDate === 'string' && body.expiryDate.trim()
            ? new Date(body.expiryDate)
            : batch.expiryDate,
      },
    })

    await logAudit({
      userId: auth.user!.userId,
      action: 'UPDATE',
      entity: 'Batch',
      entityId: id,
      details: `Updated batch "${updated.batchNumber}" (qty: ${updated.quantity})`,
      branchId: batch.branchId,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(updated)
  } catch (error) {
    // `requireBranchForWrite` throws a ValidationError, which must reach the
    // admin as the 400 it is — "select a branch" is guidance, not a server fault.
    const mapped = parseErrorResponse(error, 'Failed to update batch')
    if (mapped) return mapped
    console.error('Batch update error:', error)
    return NextResponse.json({ error: 'Failed to update batch' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireBranchScope(request, { admin: true })
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params

    // Same rule as PATCH: deleting a batch destroys one branch's stock record,
    // so it needs that branch selected. See the note above.
    const branchId = requireBranchForWrite(
      auth.scope!,
      'Select the branch whose stock you are correcting first — a batch belongs to one branch\'s shelf'
    )

    const batch = await db.batch.findFirst({
      where: { id, branchId },
    })
    if (!batch) {
      // 403 vs 404 is part of the contract, so the miss has to be classified.
      return branchMissResponse(
        await idExists(db.batch, { id }),
        'Batch not found',
        'That batch belongs to a different branch'
      )
    }

    const hasSales = await db.saleItem.count({ where: { batchId: id } })
    if (hasSales > 0) {
      return NextResponse.json(
        { error: 'Cannot delete a batch that has sales history. Set quantity to 0 instead.' },
        { status: 400 }
      )
    }

    await db.batch.delete({ where: { id } })

    await logAudit({
      userId: auth.user!.userId,
      action: 'DELETE',
      entity: 'Batch',
      entityId: id,
      details: `Deleted batch "${batch.batchNumber}"`,
      branchId: batch.branchId,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const mapped = parseErrorResponse(error, 'Failed to delete batch')
    if (mapped) return mapped
    console.error('Batch delete error:', error)
    return NextResponse.json({ error: 'Failed to delete batch' }, { status: 500 })
  }
}
