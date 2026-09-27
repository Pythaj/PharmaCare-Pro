-- ============================================================================
-- Pre-branch data backfill. Runs BEFORE `prisma db push` on every cloud deploy.
-- ============================================================================
--
-- WHY THIS EXISTS
-- The multi-branch schema makes `branchId` NOT NULL on batches, sales,
-- purchases and daily till records. `prisma db push` cannot add a required
-- column to a table that already has rows -- PostgreSQL rejects it with
-- "column contains null values" and the whole deploy fails.
--
-- So the column has to be introduced in stages, and this file is stage two:
--
--   1. add the column as NULLABLE   (this file)
--   2. point every existing row at the default branch   (this file)
--   3. enforce NOT NULL + indexes + foreign keys   (prisma db push)
--
-- SAFETY
-- Every statement is idempotent and non-destructive. There is no DROP, no
-- DELETE, and no NOT NULL tightening here, so re-running this on every deploy
-- is safe and a failure aborts the build rather than corrupting anything.
-- All the IF EXISTS / IF NOT EXISTS / IS NULL guards mean a second run is a
-- no-op.
--
-- The one judgement call is in section 5, and it is a security fix, not
-- cosmetic: see the comment there.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The branches table itself. Production predates the Branch model, so
--    `prisma db push` would create it - but we need it to exist *now* in order
--    to have a branch to point the existing rows at.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "branches" (
  "id"        TEXT        NOT NULL,
  "name"      TEXT        NOT NULL,
  "code"      TEXT        NOT NULL,
  "address"   TEXT,
  "phone"     TEXT,
  "active"    BOOLEAN     NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "branches_code_key" ON "branches" ("code");


-- ----------------------------------------------------------------------------
-- 2. The branch that pre-branch data belongs to.
--
--    This system only had one physical location before branches existed, so
--    every existing sale, batch, purchase and till record is, by definition,
--    from the original shop. Using a fixed id keeps this idempotent: the
--    second run hits the primary key and does nothing.
-- ----------------------------------------------------------------------------
INSERT INTO "branches" ("id", "name", "code", "active", "createdAt", "updatedAt")
VALUES (
  'brh_legacy_main',
  'Main Branch',
  'MAIN',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;


-- ----------------------------------------------------------------------------
-- 3. Add `branchId` as NULLABLE. Safe on a populated table: existing rows
--    simply read NULL until section 4 fills them in.
-- ----------------------------------------------------------------------------
ALTER TABLE "batches"             ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "sales"               ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "purchases"           ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "daily_sales_records" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "users"               ADD COLUMN IF NOT EXISTS "branchId" TEXT;


-- ----------------------------------------------------------------------------
-- 4. Point every pre-branch row at the default branch.
--
--    This is safe for the compound unique keys that `prisma db push` is about
--    to create, because every row lands on the *same* branch:
--      * batches  (productId, batchNumber, branchId) - a delivery that used to
--        be unique by (productId, batchNumber) stays unique once one branch id
--        is added, because that id is constant.
--      * daily_sales_records (date, branchId) - previously unique on `date`
--        alone, so no two rows can collide on a new constant column.
-- ----------------------------------------------------------------------------
UPDATE "batches"             SET "branchId" = 'brh_legacy_main' WHERE "branchId" IS NULL;
UPDATE "sales"               SET "branchId" = 'brh_legacy_main' WHERE "branchId" IS NULL;
UPDATE "purchases"           SET "branchId" = 'brh_legacy_main' WHERE "branchId" IS NULL;
UPDATE "daily_sales_records" SET "branchId" = 'brh_legacy_main' WHERE "branchId" IS NULL;


-- ----------------------------------------------------------------------------
-- 5. SECURITY: pin every non-admin user to the default branch.
--
--    `users.branchId` is nullable, and NULL means "every branch" - it is the
--    all-branches view reserved for owners. Leaving a pre-branch SALESPERSON
--    with a NULL branchId would silently promote every existing staff account
--    to see all branches' money and stock, which is exactly what branch
--    isolation exists to prevent. Admins are deliberately left NULL so they
--    keep their all-branches view; an owner can then reassign each
--    salesperson to their real location from the Branches screen.
-- ----------------------------------------------------------------------------
UPDATE "users" SET "branchId" = 'brh_legacy_main' WHERE "branchId" IS NULL AND "role" <> 'admin';
