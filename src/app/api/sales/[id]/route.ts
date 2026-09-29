import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'
import { recomputeDailyRecord } from '@/lib/daily-sales'

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
      subtotal: Number(sale.subtotal),
      totalAmount: Number(sale.totalAmount),
      profit: Number(sale.profit),
      items: sale.items.map((item) => {
        const returnedQuantity = item.returnItems.reduce((sum, ri) => sum + ri.quantity, 0);
        return {
          ...item,
          returnItems: undefined,
          returnedQuantity,
          returnableQuantity: Math.max(0, item.quantity - returnedQuantity),
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          costPrice: Number(item.costPrice),
          total: Number(item.total),
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

    const sale = await db.sale.findUnique({
      where: { id },
      include: {
        _count: { select: { returns: true } },
        items: true,
      },
    })

    if (!sale) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
    }

    // Deleting a sale returns its units to the batches they came off. An admin
    // parked on Branch A must not be able to void a Branch B sale, because the
    // restoring `increment` below would credit Branch A's shelf with stock that
    // Branch B had already sold — inventing inventory out of nothing.
    if (auth.scope!.branchId && sale.branchId !== auth.scope!.branchId) {
      return NextResponse.json(
        { error: 'That sale belongs to a different branch' },
        { status: 403 }
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
    // The restore is branch-checked rather than trusted. `POST /api/sales` now
    // refuses to sell a batch the till does not own, so a correctly-written sale
    // can only ever reference its own branch's batches. But a database that ran
    // before that fix may already contain a sale pointing at a foreign batch, and
    // crediting that shelf on void would invent inventory in a branch that never
    // sold the goods. So the branch is re-asserted here instead of assumed: the
    // sale is still deleted (the operator asked for that), but the mis-attributed
    // units are left where they are and logged loudly enough to reconcile.
    await db.$transaction(async (tx) => {
      for (const item of sale.items) {
        if (!item.batchId) continue
        const batch = await tx.batch.findFirst({
          where: { id: item.batchId, branchId: sale.branchId },
          select: { id: true },
        })
        if (!batch) {
          console.error(
            `[DELETE /api/sales/${id}] sale ${sale.invoiceNo}: item ${item.id} references batch ` +
              `${item.batchId}, which is not owned by branch ${sale.branchId} — skipped restoring ` +
              `${item.quantity} unit(s). This is pre-existing cross-branch data; reconcile manually.`
          )
          continue
        }
        await tx.batch.update({
          where: { id: item.batchId },
          data: { quantity: { increment: item.quantity } },
        })
      }
      // SaleItem has onDelete: Cascade, so deleting the sale removes its items
      await tx.sale.delete({ where: { id } })
    })

    // Keep the day's register totals in sync with reality after the delete.
    // (Runs after the transaction; recomputes from actual sales so it is
    // always correct regardless of record status.)
    //
    // The branch MUST be passed: with one register per branch per day, omitting
    // it makes this recompute whichever branch's record the database happens to
    // return first, writing one shop's day into another shop's till.
    const deletedDate = new Date(sale.createdAt)
    await recomputeDailyRecord(
      `${deletedDate.getFullYear()}-${String(deletedDate.getMonth() + 1).padStart(2, '0')}-${String(deletedDate.getDate()).padStart(2, '0')}`,
      undefined,
      sale.branchId
    )

    await logAudit({
      userId: auth.user!.userId,
      branchId: sale.branchId,
      action: 'DELETE',
      entity: 'Sale',
      entityId: id,
      details: `Deleted sale ${sale.invoiceNo} (GHS ${Number(sale.totalAmount).toFixed(2)}) and restored batch stock`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ message: 'Sale deleted successfully' })
  } catch (error) {
    console.error('Sale delete error:', error)
    return NextResponse.json({ error: 'Failed to delete sale' }, { status: 500 })
  }
}
