import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { requireBranchForWrite } from '@/lib/branches'
import { parseErrorResponse, branchMissResponse, idExists } from '@/lib/api-error'
import { logAudit, getClientIp } from '@/lib/audit'
import { recomputeDailyRecord } from '@/lib/daily-sales'
import { restoreBatchStock } from '@/lib/stock'
import { localDateKey } from '@/lib/dates'
import { toNumber } from '@/lib/utils'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireBranchScope(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params

    const sale = await db.sale.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
        customer: { select: { id: true, name: true, phone: true, address: true } },
        branch: { select: { id: true, name: true, code: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, unit: true } },
            batch: { select: { id: true, batchNumber: true, expiryDate: true } },
            // How much of this line is already spoken for by a return, so the
            // UI can offer only what is genuinely still returnable instead of
            // letting the cashier enter a quantity the server will reject.
            returnItems: {
              where: { return: { status: { in: ['approved', 'pending'] } } },
              select: { quantity: true },
            },
          },
        },
        returns: true,
      },
    })

    if (!sale) {
      return NextResponse.json(
        { error: 'Sale not found' },
        { status: 404 }
      )
    }

    // SECURITY, in order of strictness: the sale must belong to a branch the
    // caller may see, and a non-admin may only read their own. Branch is checked
    // first so an admin parked on Branch A cannot pull up a Branch B receipt by
    // guessing its id.
    if (
      auth.scope!.branchId &&
      sale.branchId !== auth.scope!.branchId
    ) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    if (auth.user!.role !== 'admin' && sale.userId !== auth.user!.userId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const normalized = {
      ...sale,
      subtotal: toNumber(sale.subtotal),
      totalAmount: toNumber(sale.totalAmount),
      profit: toNumber(sale.profit),
      items: sale.items.map((item) => {
        const returnedQuantity = item.returnItems.reduce((sum, ri) => sum + ri.quantity, 0);
        return {
          ...item,
          returnItems: undefined,
          returnedQuantity,
          returnableQuantity: Math.max(0, item.quantity - returnedQuantity),
          quantity: toNumber(item.quantity),
          unitPrice: toNumber(item.unitPrice),
          costPrice: toNumber(item.costPrice),
          total: toNumber(item.total),
        };
      }),
    }

    return NextResponse.json(normalized)
  } catch (error) {
    console.error('Sale get error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sale' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // DESTRUCTIVE — admin only
  const auth = await requireBranchScope(request, { admin: true })
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params

    // Voiding a sale is a stock write: it restores units to specific batches.
    // That stock belongs to exactly one branch, so the branch must be selected.
    // The old test — `if (scope.branchId && sale.branchId !== scope.branchId)` —
    // was skipped entirely on the consolidated "All branches" view, where
    // `scope.branchId` is null, so an admin browsing the whole business could
    // void any branch's receipt and have its units credited to the batches it
    // names. Selecting the branch is what makes the target unambiguous.
    const branchId = requireBranchForWrite(
      auth.scope!,
      'Select the branch holding this sale before voiding it — stock is returned to that branch only'
    )

    const sale = await db.sale.findFirst({
      where: { id, branchId },
      include: {
        _count: { select: { returns: true } },
        items: true,
      },
    })

    if (!sale) {
      // 403 vs 404 is part of the contract, so the miss has to be classified.
      return branchMissResponse(
        await idExists(db.sale, { id }),
        'Sale not found',
        'That sale belongs to a different branch'
      )
    }

    if (sale._count.returns > 0) {
      return NextResponse.json(
        { error: 'Cannot delete sale with existing return records' },
        { status: 400 }
      )
    }

    // Atomic: restore batch quantities BEFORE removing the sale so stock
    // never silently disappears with the record (data-integrity fix).
    //
    // The restore goes through the shared helper, which re-asserts that each
    // batch belongs to the sale's branch rather than trusting it. `POST
    // /api/sales` refuses to sell a batch the till does not own, so a
    // correctly-written sale can only reference its own branch's batches — but a
    // database that ran before that fix may already contain a sale pointing at a
    // foreign batch, and crediting that shelf on void would invent inventory in a
    // branch that never sold the goods. Those lines are skipped and logged by the
    // helper instead: the sale is still deleted (the operator asked for that), but
    // the mis-attributed units stay put.
    await db.$transaction(async (tx) => {
      await restoreBatchStock(
        tx,
        sale.items.map((item) => ({ batchId: item.batchId, quantity: Number(item.quantity) })),
        sale.branchId,
        `DELETE /api/sales/${id} sale ${sale.invoiceNo}`
      );
      // SaleItem has onDelete: Cascade, so deleting the sale removes its items
      await tx.sale.delete({ where: { id } });
    });

    // Keep the day's register totals in sync with reality after the delete.
    // (Runs after the transaction; recomputes from actual sales so it is
    // always correct regardless of record status.)
    //
    // The branch MUST be passed: with one register per branch per day, omitting
    // it makes this recompute whichever branch's record the database happens to
    // return first, writing one shop's day into another shop's till.
    await recomputeDailyRecord(localDateKey(sale.createdAt), undefined, sale.branchId)

    await logAudit({
      userId: auth.user!.userId,
      branchId: sale.branchId,
      action: 'DELETE',
      entity: 'Sale',
      entityId: id,
      details: `Deleted sale ${sale.invoiceNo} (GHS ${toNumber(sale.totalAmount).toFixed(2)}) and restored batch stock`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ message: 'Sale deleted successfully' })
  } catch (error) {
    const mapped = parseErrorResponse(error, 'Failed to delete sale')
    if (mapped) return mapped
    console.error('Sale delete error:', error)
    return NextResponse.json({ error: 'Failed to delete sale' }, { status: 500 })
  }
}
