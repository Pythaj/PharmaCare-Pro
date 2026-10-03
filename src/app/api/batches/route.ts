import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { logAudit, getClientIp } from '@/lib/audit'
import { branchWhere, requireBranchForWrite } from '@/lib/branches'
import { ConflictError, parseErrorResponse, isUniqueConstraintError } from '@/lib/api-error'
import {
  loadBranchProductOverrides,
  resolveEffectiveValues,
} from '@/lib/branch-product-settings'

/**
 * Picks the next free `BATCH-nnn` for a product.
 *
 * Numbered across the WHOLE product rather than per branch, on purpose. A batch
 * number is what an owner reads off a receipt and quotes back over the phone, and
 * `daily-items` groups distinct batch numbers per product ACROSS branches — so
 * per-branch numbering would let Central's BATCH-001 and Accra's BATCH-001 be
 * the same string for different deliveries, and the report would silently merge
 * them. One sequence per product keeps a number unambiguous everywhere.
 *
 * `extraTaken` lets a retry reuse the set it already read instead of re-querying:
 * after a collision the next number only ever moves forward, so the original
 * read is still a superset of what is taken, plus the one just lost.
 */
async function generateBatchNumber(
  client: any,
  productId: string,
  extraTaken: Set<string> = new Set()
): Promise<string> {
  const existing = await client.batch.findMany({
    where: { productId },
    select: { batchNumber: true },
  })
  const taken = new Set<string>(extraTaken)
  for (const b of existing as { batchNumber: string }[]) taken.add(b.batchNumber)

  // Start from the highest suffix in use, not from the row count. Counting rows
  // restarts numbering after a delete and then walks forward through every
  // already-taken value one probe at a time — O(n) queries' worth of nonsense for
  // a value that can be read straight off the strings.
  let highest = 0;
  for (const number of taken) {
    const match = /^BATCH-(\d+)$/.exec(number);
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > highest) highest = n;
  }

  let next = highest + 1;
  while (taken.has(`BATCH-${String(next).padStart(3, '0')}`)) next += 1;
  return `BATCH-${String(next).padStart(3, '0')}`;
}

export async function GET(request: NextRequest) {
  const auth = await requireBranchScope(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('productId') || ''
    const expiringSoon = searchParams.get('expiringSoon') === 'true'

    const now = new Date()
    const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

    // Branch-scoped, always. Stock physically sitting on another branch's shelf
    // is not this branch's inventory: showing it lets a cashier promise a
    // customer something the shop does not hold, and hides the real shortfall.
    const where: Record<string, unknown> = branchWhere(auth.scope!)

    if (productId) {
      where.productId = productId
    }

    if (expiringSoon) {
      where.expiryDate = { lte: ninetyDaysFromNow }
      where.quantity = { gt: 0 }
    }

    const batches = await db.batch.findMany({
      where,
      include: {
        product: {
          select: { id: true, name: true, unit: true, reorderLevel: true },
        },
        purchase: {
          select: { id: true, invoiceNo: true, createdAt: true },
        },
        branch: {
          select: { id: true, name: true, code: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(batches.map((b) => ({
      ...b,
      quantity: Number(b.quantity),
      costPrice: Number(b.costPrice),
      sellingPrice: Number(b.sellingPrice),
    })))
  } catch (error) {
    console.error('Batches list error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch batches' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/batches — create a new stock batch for a product.
 * Admin only. Body: { productId, batchNumber, quantity, costPrice, sellingPrice, expiryDate }
 *
 * batchNumber and expiryDate are OPTIONAL — they must never block adding stock.
 * When omitted: a unique batch number is generated automatically and the expiry
 * defaults to +24 months from today.
 */
export async function POST(request: NextRequest) {
  const auth = await requireBranchScope(request, { admin: true })
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

// Stock is physically held at one branch, so receiving stock requires a
  // branch. Refuse rather than silently filing it under a default.
  //
  // First statement inside the try: the guard throws, and the catch below is
  // what renders that as a 400. Outside the try it would be a 500, which is
  // both a lie and a worse message for the operator.
  try {
    const branchId = requireBranchForWrite(
      auth.scope!,
      'Select the branch receiving this stock before adding a batch'
    )

    // "All branches" is a read-only view, so there is nothing to inherit from —
    // an empty map makes every price fall through to the product default.
    const overrides = await loadBranchProductOverrides(branchId)

    const body = await request.json()
    const { productId } = body

    if (!productId) {
      return NextResponse.json({ error: 'productId is required' }, { status: 400 })
    }

    const product = await db.product.findUnique({ where: { id: productId } })
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const quantity = Math.max(0, Number(body.quantity ?? 0) || 0)

    // Price resolution, in order of authority:
    //   1. the number on the request (an explicit price always wins)
    //   2. this branch's BranchProductSetting default
    //   3. the chain-wide Product default
    //
    // This used to be `Number(body.sellingPrice ?? 0) || 0`, so a delivery
    // received without a price was filed at zero — free stock, a free sale at
    // the till, and a cost report that silently understated the branch. Falling
    // back to the product default is what every other price entry point already
    // did; the branch override is what lets a shop that prices a product
    // differently stop retyping it on each delivery.
    const effective = resolveEffectiveValues(
      product,
      overrides.get(productId)
    )

    const costPrice =
      body.costPrice !== undefined && body.costPrice !== null && body.costPrice !== ''
        ? Math.max(0, Number(body.costPrice) || 0)
        : effective.costPrice;

    const sellingPrice =
      body.sellingPrice !== undefined && body.sellingPrice !== null && body.sellingPrice !== ''
        ? Math.max(0, Number(body.sellingPrice) || 0)
        : effective.sellingPrice;

    // Expiry: optional — default to +24 months when not supplied or empty.
    let expiryDate = new Date()
    expiryDate.setMonth(expiryDate.getMonth() + 24)
    if (typeof body.expiryDate === 'string' && body.expiryDate.trim()) {
      const parsed = new Date(body.expiryDate)
      if (isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: 'Invalid expiryDate (expected YYYY-MM-DD)' },
          { status: 400 }
        )
      }
      expiryDate = parsed
    }

// Batch number: optional — generate a unique one automatically when blank
    // so an empty field never blocks adding inventory. A caller-supplied number
    // is honoured verbatim and is NOT auto-deduplicated: the operator typing
    // "LOT-XYZ-9" means that lot, and silently renaming it would break the link
    // to the supplier's paperwork.
    const suppliedBatchNumber =
      typeof body.batchNumber === 'string' && body.batchNumber.trim()
        ? body.batchNumber.trim()
        : null;

    if (suppliedBatchNumber) {
      const existing = await db.batch.findFirst({
        // Scoped to the branch: the same delivery legitimately exists in two
        // branches, so "already exists" must mean "already exists HERE".
        where: { productId, batchNumber: suppliedBatchNumber, branchId },
      });
      if (existing) {
        return NextResponse.json(
          {
            error: `Batch "${suppliedBatchNumber}" already exists for this product at ${
              auth.branch?.name ?? 'this branch'
            }`,
          },
          { status: 409 }
        );
      }
    }

    /* Generated numbers are resolved against the database at insert time rather
     * than by "look, then insert".
     *
     * Two operators stocking the same product at the same branch a second apart
     * both read the same set of taken numbers, both compute the same next one,
     * and both proceed: the first insert wins and the second hits
     * `@@unique([productId, batchNumber, branchId])`. That surfaces as a raw
     * driver error, so the blanket catch turned a routine stock-in into a 500 —
     * "Something went wrong" for what is really "the other terminal got there
     * first", with the operator's stock entry lost.
     *
     * So the insert is the thing that resolves the conflict: on a unique
     * violation, mark that number as taken and ask again. The pre-check stays for
     * SUPPLIED numbers, where a duplicate is a genuine user error worth a 409
     * with an explanation, not something to paper over by renaming their lot. */
    const takenSoFar = new Set<string>();
    let batch: Awaited<ReturnType<typeof db.batch.create>> | undefined;
    let lastCollision: unknown;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const batchNumber =
        suppliedBatchNumber ?? (await generateBatchNumber(db, productId, takenSoFar));

      try {
        batch = await db.batch.create({
          data: {
            productId,
            branchId,
            batchNumber,
            quantity,
            costPrice,
            sellingPrice,
            expiryDate,
          },
        });
        break;
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        // Remember the losing number so the next attempt steps past it. For a
        // supplied number there is no next attempt worth making: it is the
        // caller's own value, and the pre-check above already returned 409 for
        // the cases it can see.
        if (suppliedBatchNumber) throw error;
        takenSoFar.add(batchNumber);
        lastCollision = error;
      }
    }

    if (!batch) {
      /* Five collisions on an auto-generated number means something other than a
         race — most likely a batch being inserted in a tight loop by an import.
         Surfaced as a 409 with a message the operator can act on; the generic 500
         it replaces was neither. The raw driver error goes to the log only, never
         into the response. */
      console.error('Batch number allocation exhausted', {
        productId,
        branchId,
        collided: [...takenSoFar],
        lastCollision,
      });
      throw new ConflictError(
        'Could not allocate a batch number — several were taken at once. Try again.'
      );
    }

    await logAudit({
      userId: auth.user!.userId,
      action: 'CREATE',
      entity: 'Batch',
      entityId: batch.id,
      details: `Created batch "${batch.batchNumber}" (qty: ${batch.quantity}) for "${product.name}"`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(batch, { status: 201 })
} catch (error) {
    // A client mistake (no branch selected, bad field) must say so; only a real
    // fault falls through to the generic 500 below.
    const mapped = parseErrorResponse(error, 'Failed to create batch')
    if (mapped) return mapped
    console.error('Batch create error:', error)
    return NextResponse.json({ error: 'Failed to create batch' }, { status: 500 })
  }
}

