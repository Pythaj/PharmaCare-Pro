/**
 * Catalogue seeding — the single source of truth for "a drug is on the shelf at
 * every branch" (Rule 18).
 *
 * WHY THIS FILE EXISTS
 *
 * A `Product` is GLOBAL catalogue data: one row, shared by every till. A `Batch`
 * is BRANCH-OWNED stock. Those two facts used to be handled ad hoc, and each
 * place got it slightly wrong:
 *
 *  - The desktop/CLI importer created products but no batches, so a fresh
 *    install opened with an empty POS shelf.
 *  - The app's bulk-import route created a batch only for the branch that ran
 *    the import, so uploading stock at Main left every other branch unable to
 *    sell the drug.
 *  - Nothing back-filled existing products when a NEW branch was created, so
 *    opening Branch B gave an owner a completely empty catalogue until they
 *    re-ran an import.
 *
 * All three are the same bug seen from three angles: the global-product /
 * branch-batch relationship was never materialised by one shared routine.
 * `seedCatalogueForAllBranches` below is that routine, and every write path
 * calls it so a drug uploaded or a branch opened at ANY moment converges on
 * "present everywhere, stocked nowhere-invented".
 *
 * THE SAFETY RULE
 *
 * A seeded batch always has quantity 0. Real stock is counted and entered by the
 * owner per branch (Edit Drug, purchases, transfers). This helper must NEVER
 * copy or invent a quantity, because duplicating stock would let a branch sell
 * units it does not physically have. It also never mutates an existing batch:
 * the upsert below uses `update: {}`, so a batch that already holds counted
 * stock keeps its quantity, cost and selling price untouched. Seeding is purely
 * additive — it only ever fills in missing (product, branch) gaps.
 *
 * WHY A SEEDED BATCH IS PRICED, NOT ZERO
 *
 * Quantity 0 but prices are NOT 0. The POS charges `min(sellingPrice)` across
 * sellable batches, and `PATCH /api/batches/[id]` deliberately allows a
 * quantity-only adjustment (`sellingPrice` is optional there). So a starter
 * batch priced at 0 is a loaded gun: the moment that branch receives its first
 * stock by adjusting the batch, the drug is sold for nothing — silently, at
 * every branch opened before the next price edit.
 *
 * Seeding the product's CURRENT catalogue price closes that hole without
 * inventing anything: the number is the price the owner already set for the
 * drug, not a guess, and it is not applied to any batch that already exists.
 * A later global reprice rewrites every batch anyway, so the seeded figure is
 * only ever the starting point.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

/** The batch number used for auto-seeded, quantity-0 catalogue batches. */
export const SEED_BATCH_NUMBER = 'STOCK-001';

/** How long a seeded (never-stocked) batch nominally "expires" — far enough out
 * that it never trips expiry alerts, but a real value because the column is
 * required. The owner sets a true expiry the moment they add real stock. */
function seedExpiryDate(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 100);
  return d;
}

/**
 * Coerce a money column to a number for `createMany`.
 *
 * The two schemas disagree with each other here: `defaultCostPrice` is
 * `Decimal` but `defaultSellingPrice` is `Float`, on BOTH prisma/schema.prisma
 * and prisma/schema.postgres.prisma. Calling `.toNumber()` unconditionally
 * therefore throws on the selling price and 500s every write path that seeds
 * (product create, import, branch create). Accepting both shapes is the fix.
 */
function toMoney(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : value.toNumber();
}

/**
 * Ensure every product has a starter batch at every active branch.
 *
 * Idempotent and additive:
 *  - Products already covered at a branch are left completely untouched (their
 *    batch may hold real stock, a real cost and a real selling price).
 *  - Missing (product, branch) pairs get a quantity-0 batch so the drug appears
 *    in that branch's catalogue and POS without pretending stock exists.
 *
 * @param db            Prisma client or an interactive-transaction client.
 * @param productIds    Restrict to these products. Omit to cover ALL products —
 *                      this is what a new branch calls.
 * @returns counts for logging/telemetry.
 */
export async function seedCatalogueForAllBranches(
  db: PrismaClient | Prisma.TransactionClient,
  productIds?: string[]
): Promise<{ products: number; branches: number; batchesCreated: number }> {
  const branches = await db.branch.findMany({
    where: { active: true },
    select: { id: true },
  });
  const branchIds = branches.map((b) => b.id);

  // With no active branch there is nowhere for catalogue stock to live yet, and
  // silently doing nothing is how a fresh install ends up empty. The caller
  // surfaces this as a configuration error.
  if (branchIds.length === 0) {
    throw new Error('No active branches exist to seed the catalogue against');
  }

  const products = await db.product.findMany({
    where: productIds && productIds.length > 0 ? { id: { in: productIds } } : {},
    select: { id: true, defaultCostPrice: true, defaultSellingPrice: true },
  });

  if (products.length === 0) {
    return { products: 0, branches: branchIds.length, batchesCreated: 0 };
  }

  // Which (product, branch) pairs already have a starter batch? Everything not
  // in this set gets a zero-quantity row. Reading first (instead of upserting
  // every pair blindly) keeps this to one query and makes the "never touch
  // existing stock" guarantee obvious at a glance.
  const existing = await db.batch.findMany({
    where: {
      batchNumber: SEED_BATCH_NUMBER,
      productId: { in: products.map((p) => p.id) },
      branchId: { in: branchIds },
    },
    select: { productId: true, branchId: true },
  });

  const covered = new Set(existing.map((b) => `${b.productId}::${b.branchId}`));
  const expiryDate = seedExpiryDate();
  const missing: { productId: string; branchId: string; costPrice: number; sellingPrice: number }[] = [];

  for (const product of products) {
    const costPrice = toMoney(product.defaultCostPrice);
    const sellingPrice = toMoney(product.defaultSellingPrice);
    for (const branchId of branchIds) {
      if (!covered.has(`${product.id}::${branchId}`)) {
        missing.push({ productId: product.id, branchId, costPrice, sellingPrice });
      }
    }
  }

  if (missing.length === 0) {
    return { products: products.length, branches: branchIds.length, batchesCreated: 0 };
  }

  const rows = missing.map((m) => ({
    productId: m.productId,
    branchId: m.branchId,
    batchNumber: SEED_BATCH_NUMBER,
    quantity: 0,
    costPrice: m.costPrice,
    sellingPrice: m.sellingPrice,
    expiryDate,
  }));

  // Fast path: one INSERT for all the gaps. `skipDuplicates` is deliberately NOT
  // used — Prisma only supports it on PostgreSQL/MySQL and throws on SQLite, so
  // it would break every desktop build. We only ever insert pairs proven missing
  // above, so a duplicate can only come from a concurrent writer racing us.
  try {
    await db.batch.createMany({ data: rows });
    return {
      products: products.length,
      branches: branchIds.length,
      batchesCreated: rows.length,
    };
  } catch (error) {
    // Lost a race: another request seeded some of these pairs between our read
    // and our insert. Fall back to per-row upserts, which are idempotent and
    // provider-agnostic, so the invariant still converges instead of 500-ing.
    const isUniqueViolation =
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'P2002';

    if (!isUniqueViolation) throw error;

    for (const row of rows) {
      await db.batch.upsert({
        where: {
          productId_batchNumber_branchId: {
            productId: row.productId,
            batchNumber: row.batchNumber,
            branchId: row.branchId,
          },
        },
        create: row,
        update: {},
      });
    }

    return {
      products: products.length,
      branches: branchIds.length,
      batchesCreated: rows.length,
    };
  }
}
