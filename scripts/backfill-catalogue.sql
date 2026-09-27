-- ============================================================================
-- Catalogue coverage backfill. Runs AFTER `prisma db push` on every cloud deploy.
-- ============================================================================
--
-- WHY THIS EXISTS
--
-- A `Product` is global catalogue data. A `Batch` is branch-owned stock. So for
-- a drug to be sellable at a branch, that branch needs a Batch row for it.
--
-- The app now creates those rows on its own (src/lib/catalogue-seeding.ts, called
-- from product create, bulk import, branch create and branch reactivation). But
-- every product that already existed BEFORE that logic shipped has no Batch at
-- any branch beyond the one it happened to be stocked in, so on the live site a
-- drug the owner has carried for years is missing from the till at every other
-- branch. This repairs that history.
--
-- WHAT IT DOES
--
-- For every (product, ACTIVE branch) pair that has no STOCK-001 batch, insert a
-- quantity-0 one. That makes the drug visible and price-ready everywhere while
-- asserting no stock exists anywhere — real quantities are entered per branch by
-- the owner, and are never copied or invented here.
--
-- The seeded row carries the product's CURRENT catalogue price, not 0. The POS
-- charges min(sellingPrice) over sellable batches and allows a quantity-only
-- batch adjustment, so a 0-priced placeholder would sell the drug for nothing
-- the first time that branch received stock. This is the same rule the runtime
-- seeder applies; see the "WHY A SEEDED BATCH IS PRICED, NOT ZERO" note in
-- src/lib/catalogue-seeding.ts.
--
-- WHY IT MUST RUN AFTER `prisma db push`
--
-- ON CONFLICT below targets the compound unique (productId, batchNumber,
-- branchId), and `branchId` must be NOT NULL. Neither is true before the push,
-- so this file cannot run in the pre-push stage alongside backfill-branch.sql.
--
-- SAFETY
--
-- Purely additive and idempotent:
--   * no DELETE, no DROP, no UPDATE of existing rows;
--   * ON CONFLICT DO NOTHING means a second run inserts nothing;
--   * existing batches are never touched, so counted stock, real cost and real
--     selling prices are preserved exactly.
-- A failure aborts the build rather than leaving a half-applied catalogue.
--
-- Kept deliberately in step with SEED_BATCH_NUMBER and the quantity-0 rule in
-- src/lib/catalogue-seeding.ts — that module is the runtime source of truth,
-- this file is the one-time repair of rows that predate it.
-- ============================================================================

INSERT INTO "batches" (
  "id",
  "productId",
  "branchId",
  "batchNumber",
  "quantity",
  "costPrice",
  "sellingPrice",
  "expiryDate",
  "createdAt",
  "updatedAt"
)
SELECT
  -- cuid() is generated client-side by Prisma, so raw SQL must supply an id.
  -- This is a stable synthetic one: same inputs always produce the same id, so
  -- a re-run collides on the primary key and the ON CONFLICT below is a no-op.
  'cat_' || md5(p."id" || '::' || b."id" || '::STOCK-001'),
  p."id",
  b."id",
  'STOCK-001',
  0,
  p."defaultCostPrice",
  p."defaultSellingPrice",
  -- Far enough out that a quantity-0 placeholder never trips an expiry alert.
  -- The owner sets a true expiry when they add real stock.
  CURRENT_TIMESTAMP + INTERVAL '100 years',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "products" p
CROSS JOIN "branches" b
WHERE b."active" = true
  AND NOT EXISTS (
    SELECT 1
    FROM "batches" existing
    WHERE existing."productId" = p."id"
      AND existing."batchNumber" = 'STOCK-001'
      AND existing."branchId" = b."id"
  )
ON CONFLICT ("productId", "batchNumber", "branchId") DO NOTHING;


-- ----------------------------------------------------------------------------
-- Verify the invariant actually holds, and fail the deploy if it does not.
--
-- Silence here would be the dangerous outcome: a partial insert or a silently
-- skipped branch would ship an app where a drug is missing from some tills, and
-- the owner would find out at the counter. So the build asserts the end state
-- instead of trusting the statement above.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  uncovered INTEGER;
BEGIN
  SELECT COUNT(*) INTO uncovered
  FROM "products" p
  CROSS JOIN "branches" b
  WHERE b."active" = true
    AND NOT EXISTS (
      SELECT 1
      FROM "batches" existing
      WHERE existing."productId" = p."id"
        AND existing."batchNumber" = 'STOCK-001'
        AND existing."branchId" = b."id"
    );

  IF uncovered > 0 THEN
    RAISE EXCEPTION
      'Catalogue backfill incomplete: % product/branch pair(s) still have no starter batch, so those drugs would be missing from a till. Aborting deploy.',
      uncovered;
  END IF;
END $$;
