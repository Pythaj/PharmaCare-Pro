import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { requireBranchForWrite } from '@/lib/branches'
import { logAudit, getClientIp } from '@/lib/audit'
import { branchRelationWhere } from '@/lib/branches'
import {
  allocateRefunds,
  isReturnStatus,
  recomputeSaleStatus,
  sumRefunds,
  RETURN_STATUSES,
} from '@/lib/returns'
import { ValidationError, ConflictError, parseErrorResponse, branchMissResponse, idExists } from '@/lib/api-error'
import { restoreBatchStock } from '@/lib/stock'
import { toNumber } from '@/lib/utils'

// Returns are an admin-managed area (returns move stock and money), so the gate
// is requireAdmin for reads and writes alike. Reads are still branch-scoped: an
// admin parked on Branch A should reconcile Branch A's refunds, not the whole
// company's. A return inherits its branch from the sale it refunds, so the
// filter is on the related sale.
export async function GET(request: NextRequest) {
  const auth = await requireBranchScope(request, { admin: true })
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const returns = await db.return.findMany({
      where: branchRelationWhere(auth.scope!, 'sale'),
      include: {
        sale: {
          select: {
            id: true,
            invoiceNo: true,
            totalAmount: true,
            branchId: true,
            branch: { select: { id: true, name: true, code: true } },
            customer: { select: { id: true, name: true, phone: true } },
            user: { select: { id: true, name: true } },
          },
        },
        // The operator who processed the refund. Nullable relation, so a deleted
        // account leaves the refund intact and simply reads as "removed user".
        user: { select: { id: true, name: true } },
        // Line-level refunds so the UI shows what was actually credited per
        // item instead of re-deriving it from shelf prices.
        items: {
          select: {
            id: true,
            saleItemId: true,
            quantity: true,
            refundAmount: true,
            saleItem: {
              select: {
                unitPrice: true,
                product: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ returns })
  } catch (error) {
    console.error('Returns list error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch returns' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  // Identity from HttpOnly JWT cookie, resolved against the live database role.
  const auth = await requireBranchScope(request, { admin: true })
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const userId = auth.user!.userId

  try {
    const body = await request.json()
    const { saleId, reason, items, status = 'approved' } = body

    if (!saleId || typeof saleId !== 'string') {
      return NextResponse.json(
        { error: 'Sale ID is required' },
        { status: 400 }
      )
    }
    if (typeof reason !== 'string' || !reason.trim()) {
      return NextResponse.json(
        { error: 'A reason for the return is required' },
        { status: 400 }
      )
    }
    if (!isReturnStatus(status)) {
      return NextResponse.json(
        { error: `Status must be one of: ${RETURN_STATUSES.join(', ')}` },
        { status: 400 }
      )
    }

    // Find the sale and its items
    const branchId = requireBranchForWrite(
      auth.scope!,
      'Switch to the branch that made this sale before processing the return — the refunded units go back on that branch\'s shelf'
    )

    const sale = await db.sale.findFirst({
      where: { id: saleId, branchId },
      include: {
        items: {
          include: { product: { select: { name: true } } },
        },
      },
    })

    if (!sale) {
      // 403 vs 404 is part of the contract, so the miss has to be classified.
      return branchMissResponse(
        await idExists(db.sale, { id: saleId }),
        'Sale not found',
        'That sale belongs to a different branch. Switch to its branch to process the return.'
      )
    }

    // A refund puts stock back on a shelf and money back to a customer, so it
    // must land in the branch that made the original sale. Refusing here (rather
    // than silently crediting it) keeps each shop's stock count honest: the units
    // return to the shelf they left.
    //
    // The branch is now resolved by `requireBranchForWrite` and folded into the
    // query above, instead of being compared after the fetch. The old
    // `if (scope.branchId && sale.branchId !== scope.branchId)` test was skipped
    // outright on the consolidated "All branches" view, so an admin there could
    // refund any shop's receipt — moving one branch's money and stock with no
    // branch ever having been selected.
    if (sale.status === 'returned') {
      return NextResponse.json(
        { error: 'This sale has already been fully returned' },
        { status: 400 }
      )
    }

    // Everything below commits atomically — a partial failure can never leave
    // stock restored without a return record (or vice versa)
    const result = await db.$transaction(async (tx) => {
      // Previously returned quantities per sale item, across ALL prior
      // returns of this sale — prevents over-returning the same line twice
      const priorReturns = await tx.returnItem.findMany({
        where: {
          return: { saleId, status: { in: ['approved', 'pending'] } },
        },
        select: { saleItemId: true, quantity: true },
      })
      const returnedQty = new Map<string, number>()
      for (const ri of priorReturns) {
        returnedQty.set(ri.saleItemId, (returnedQty.get(ri.saleItemId) ?? 0) + ri.quantity)
      }

      // Resolve which quantities are being returned in THIS request
      let planned: { saleItemId: string; quantity: number; unitPrice: number; batchId: string | null }[]
      if (Array.isArray(items) && items.length > 0) {
        planned = []
        for (const reqItem of items) {
          const saleItem = sale.items.find((si) => si.id === reqItem?.saleItemId)
          if (!saleItem) {
            throw new ValidationError(`Sale item ${reqItem?.saleItemId} not found on this sale`)
          }
          const qty = Number(reqItem.quantity)
          if (!Number.isInteger(qty) || qty <= 0) {
            throw new ValidationError('Return quantity must be a positive whole number')
          }
          const alreadyReturned = returnedQty.get(saleItem.id) ?? 0
          const remaining = saleItem.quantity - alreadyReturned
          if (qty > remaining) {
            throw new ValidationError(
              `Cannot return ${qty} of "${saleItem.product?.name ?? 'item'}" — only ${remaining} remain returnable` +
                ` (${alreadyReturned} of ${saleItem.quantity} already returned)`
            )
          }
          planned.push({ saleItemId: saleItem.id, quantity: qty, unitPrice: toNumber(saleItem.unitPrice), batchId: saleItem.batchId })
        }
      } else {
        // Full return — refund every item's remaining un-returned quantity
        planned = sale.items
          .map((si) => ({
            saleItemId: si.id,
            quantity: si.quantity - (returnedQty.get(si.id) ?? 0),
            unitPrice: toNumber(si.unitPrice),
            batchId: si.batchId,
          }))
          .filter((p) => p.quantity > 0)
        if (planned.length === 0) {
          throw new ValidationError('All items on this sale have already been returned')
        }
      }

      // Refund what the customer actually paid for these lines: each line's
      // share of the sale's charged total. For any sale this app wrote that
      // factor is 1, but it is still computed from the recorded figures so a
      // sale booked before discount and tax were removed is refunded to the
      // cent instead of at shelf price.
      const salePricing = {
        subtotal: toNumber(sale.subtotal),
        totalAmount: toNumber(sale.totalAmount),
      }
      const allocated = allocateRefunds(planned, salePricing)
      const totalRefund = sumRefunds(allocated)

      // Create the return record + its line items together
      const returnRecord = await tx.return.create({
        data: {
          saleId,
          userId,
          reason: reason.trim(),
          totalRefund,
          status,
          items: {
            create: allocated.map((p) => ({
              saleItemId: p.saleItemId,
              quantity: p.quantity,
              refundAmount: p.refundAmount,
            })),
          },
        },
        include: {
          sale: {
            select: {
              id: true,
              invoiceNo: true,
              customer: { select: { id: true, name: true } },
            },
          },
          user: { select: { id: true, name: true } },
        },
      })

      // Re-verify the cumulative invariant against what is now PERSISTED, not
      // against what was read before this request started.
      //
      // The `priorReturns` read above only proves the line had room at the moment
      // it was read. Two cashiers refunding the same receipt at the same time both
      // read the same remaining quantity, both see room, and both commit — the
      // shelf is credited with units the pharmacy never took back, and the till
      // hands over twice what it owes. Re-counting after our own rows are written
      // sees the other transaction's work if it committed first, and rolls this
      // one back instead.
      //
      // PLACEMENT IS THE POINT. This read used to sit ABOVE the `create` above,
      // under a comment claiming it ran after the write. It did not: it re-read
      // the same pre-existing rows a second time, so it could only ever catch the
      // narrow interleaving where the other transaction committed between the two
      // reads. Run here, the re-read includes the rows this transaction just wrote
      // (a transaction always observes its own writes), so the check is a real
      // assertion about the committed state — and it still rolls back cleanly,
      // because throwing inside `$transaction` discards the create above.
      //
      // This closes the interleaved case rather than proving isolation: two
      // transactions that both re-read before either commits still pass. A hard
      // guarantee needs SERIALIZABLE isolation, which Prisma offers on PostgreSQL
      // but not on the SQLite connector used for local development, so it is not
      // something this route can turn on unconditionally.
      const soldQty = new Map(sale.items.map((si) => [si.id, si.quantity]))
      const postReturns = await tx.returnItem.findMany({
        where: { return: { saleId, status: { in: ['approved', 'pending'] } } },
        select: { saleItemId: true, quantity: true },
      })
      const postTotal = new Map<string, number>()
      for (const ri of postReturns) {
        postTotal.set(ri.saleItemId, (postTotal.get(ri.saleItemId) ?? 0) + ri.quantity)
      }
      for (const p of planned) {
        const sold = soldQty.get(p.saleItemId) ?? 0
        const claimed = postTotal.get(p.saleItemId) ?? 0
        if (claimed > sold) {
          const line = sale.items.find((si) => si.id === p.saleItemId)
          throw new ConflictError(
            `Another return for "${line?.product?.name ?? 'item'}" was processed at the same time — ` +
              `only ${sold} were sold and ${claimed} are now claimed as returned. Nothing was refunded; reload and try again.`
          )
        }
      }

      // Approved returns restore stock to the original batch immediately
      if (status === 'approved') {
        await restoreBatchStock(tx, allocated, sale.branchId, `POST /api/returns (sale ${sale.invoiceNo})`, 1)
      }

      await recomputeSaleStatus(tx, saleId, salePricing.totalAmount, sale.status)

      return { returnRecord, totalRefund, invoiceNo: sale.invoiceNo }
    })

    await logAudit({
      userId,
      action: 'RETURN',
      entity: 'Return',
      entityId: result.returnRecord.id,
      details: `Processed ${status} return for ${result.invoiceNo} (refund GHS ${result.totalRefund.toFixed(2)}): ${reason.trim()}`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(result.returnRecord, { status: 201 })
  } catch (error) {
    console.error('Return create error:', error)
    const mapped = parseErrorResponse(error, 'Failed to process return')
    if (mapped) return mapped
    return NextResponse.json(
      { error: 'Failed to process return' },
      { status: 500 }
    )
  }
}
