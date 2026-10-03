/**
 * Invoice number allocation.
 *
 * A receipt number has to be unique for as long as the day is reportable, and
 * sales ARE deleted (`DELETE /api/sales/[id]`, for mis-keyed receipts). So the
 * number cannot be derived from a count of existing rows: removing row 0007
 * lowers the count and the next sale is issued 0007 again, leaving two different
 * transactions sharing one receipt number for the rest of the day.
 *
 * That is not cosmetic. It breaks the audit trail (a delete and a later create
 * both logged under one number), makes a customer's "it was receipt 0007"
 * ambiguous, and puts a repeat in the day's receipt book that fails
 * reconciliation.
 *
 * The fix is to remember the high-water mark instead of recounting. See the
 * `SaleSequence` model for the schema and the reasoning.
 */
import type { Prisma } from '@prisma/client'

/** The numeric suffix of `ACC-INV-20260114-0007`, or null if it is not ours. */
function suffixOf(invoiceNo: string): number | null {
  const match = /-(\d+)$/.exec(invoiceNo)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) ? n : null
}

/**
 * The highest invoice suffix already on file for this branch and day.
 *
 * Only used to SEED a sequence the first time one is needed for a branch/day, so
 * that numbers issued by the old count-based code are never reissued on the day
 * this lands. After the first seed the stored high-water mark is authoritative
 * and this is not consulted again.
 *
 * Non-matching rows (hand-entered or imported numbers) are ignored rather than
 * treated as 0: they carry no suffix to compare, and inventing one would risk
 * colliding with a numbered receipt issued since.
 */
async function highestNumberOnFile(
  tx: Prisma.TransactionClient,
  branchId: string,
  dayStart: Date,
  dayEnd: Date
): Promise<number> {
  const rows = await tx.sale.findMany({
    where: { createdAt: { gte: dayStart, lt: dayEnd }, branchId },
    select: { invoiceNo: true },
  })

  let highest = 0
  for (const row of rows) {
    const suffix = suffixOf(row.invoiceNo)
    if (suffix !== null && suffix > highest) highest = suffix
  }
  return highest
}

/**
 * Reserves the next invoice number for a branch on a day and returns it.
 *
 * MUST be called inside the sale's transaction. That is what makes the reservation
 * safe in both directions: the increment is committed with the sale, so a sale
 * that fails consumes nothing and leaves no gap; and two concurrent sales cannot
 * interleave a read and a write, because the increment is a single atomic upsert.
 *
 * The `create` branch seeds from the highest number already on file rather than
 * from 1, so a branch that has been trading all day does not restart at 0001 the
 * moment this ships. `update` then increments, which is what two concurrent sales
 * actually contend on — Postgres resolves it as `ON CONFLICT ... DO UPDATE SET
 * lastNumber = lastNumber + 1` under a row lock, so each caller gets a distinct
 * number with no explicit locking and no retry loop.
 */
export async function nextInvoiceNumber(
  tx: Prisma.TransactionClient,
  params: {
    branchId: string
    branchCode: string
    date: string
    dayStart: Date
    dayEnd: Date
  }
): Promise<string> {
  const { branchId, branchCode, date, dayStart, dayEnd } = params

  const seed = await highestNumberOnFile(tx, branchId, dayStart, dayEnd)

  const sequence = await tx.saleSequence.upsert({
    where: { branchId_date: { branchId, date } },
    // First sale of this branch/day under this code: start above everything
    // already issued rather than at 1.
    create: { branchId, date, lastNumber: seed + 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  })

  return `${branchCode}-INV-${date}-${String(sequence.lastNumber).padStart(4, '0')}`
}