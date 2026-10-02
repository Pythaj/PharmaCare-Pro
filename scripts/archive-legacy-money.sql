-- ============================================================================
-- Archive the retired tax/discount columns. Runs BEFORE `prisma db push` on
-- every cloud deploy.
-- ============================================================================
--
-- WHY THIS EXISTS
--
-- Tax and discount were removed from the product, so the schema no longer has
-- `sales.tax`, `sales.discount` or `daily_sales_records.totalDiscount`. The next
-- `prisma db push` will therefore DROP those three columns.
--
-- They are not empty columns. Every sale rung before the feature was retired
-- carries the pharmacist's discount and the VAT charged on that sale, and the
-- shop may still be asked to account for those figures years later — they are
-- part of the tax history, not a display preference. `--accept-data-loss` is
-- already required by the build (the compound unique keys cannot be added
-- without it), which means that flag would quietly authorise destroying them
-- too. Nothing in the build was checking.
--
-- So this runs first and copies every non-zero figure into two tables the
-- Prisma schema does not own (`@@ignore()`), which no future push will ever
-- drop. The values stay in the pharmacy's own database, keyed to the invoice and
-- the business date they belong to, and can be reported or reinstated at any
-- time.
--
-- WHY ARCHIVE RATHER THAN BLOCK
--
-- Blocking the deploy would protect the data too, but it would do it by stopping
-- the client from shipping a fix. Archiving first means the money is preserved
-- AND the release goes out. If the archive cannot be written, or cannot be
-- proven complete, this raises and the deploy stops with the columns still
-- intact — the failure mode is "nothing happened", never "data gone".
--
-- SAFETY
--
--   * No DELETE, no DROP, no UPDATE of existing rows — only CREATE IF NOT EXISTS
--     and INSERT ... ON CONFLICT DO NOTHING, so a re-run archives nothing extra.
--   * Rows whose tax and discount are both zero are not archived: there is no
--     figure there to preserve, only an absence of one.
--   * Idempotent and order-independent: it runs before the push that drops the
--     columns, and does nothing at all once they are gone.
--   * Two-phase: the copy runs, then a verification block asserts that the
--     archive holds at least as many rows and as much value as the columns did.
--     Only then does the build go on to `db push`.
--
-- The archive tables are declared in prisma/schema*.prisma with `@@ignore()` so
-- they are documented and provably unmanaged, rather than being invisible
-- side-effects of a deploy.
-- ============================================================================


CREATE TABLE IF NOT EXISTS "legacy_sale_money" (
  "sale_id"     TEXT           NOT NULL,
  "invoice_no"  TEXT           NOT NULL,
  "sold_at"     TIMESTAMP(3)   NOT NULL,
  "tax"         DECIMAL(65,30) NOT NULL,
  "discount"    DECIMAL(65,30) NOT NULL,
  "archived_at" TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legacy_sale_money_pkey" PRIMARY KEY ("sale_id")
);

CREATE TABLE IF NOT EXISTS "legacy_daily_discount" (
  "record_id"      TEXT           NOT NULL,
  "business_date"  TEXT           NOT NULL,
  "total_discount" DECIMAL(65,30) NOT NULL,
  "archived_at"    TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legacy_daily_discount_pkey" PRIMARY KEY ("record_id")
);


-- ----------------------------------------------------------------------------
-- 1. Copy the figures out. The column checks are information_schema lookups
--    because on the second and later deploys the columns are already gone, and
--    referencing a dropped column would abort the build for no reason.
--
--    The copy lives inside a DO block so PostgreSQL only prepares those
--    statements on a run where the columns are actually present: PL/pgSQL
--    compiles a statement when it is first reached, not when the block is
--    parsed.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'sales' AND column_name = 'tax'
  ) THEN
    INSERT INTO "legacy_sale_money" ("sale_id", "invoice_no", "sold_at", "tax", "discount")
    SELECT s."id", s."invoiceNo", s."createdAt", s."tax", s."discount"
    FROM "sales" s
    WHERE COALESCE(s."tax", 0) <> 0 OR COALESCE(s."discount", 0) <> 0
    ON CONFLICT ("sale_id") DO NOTHING;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'daily_sales_records'
      AND column_name = 'totalDiscount'
  ) THEN
    INSERT INTO "legacy_daily_discount" ("record_id", "business_date", "total_discount")
    SELECT d."id", d."date", d."totalDiscount"
    FROM "daily_sales_records" d
    WHERE COALESCE(d."totalDiscount", 0) <> 0
    ON CONFLICT ("record_id") DO NOTHING;
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 2. PREFLIGHT: prove the archive is complete before anything is dropped.
--
--    This is the same rule the rest of the deploy follows — assert the end
--    state rather than trust the statement above. It compares row count AND
--    total value, because an archive can match on count while holding the wrong
--    figures. `>=` rather than `=`: the archive may legitimately hold extra rows
--    for sales that have since been cleared from the register, and keeping those
--    is the whole point.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  src_count  BIGINT;
  src_total  NUMERIC;
  arc_count  BIGINT;
  arc_total  NUMERIC;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'sales' AND column_name = 'tax'
  ) THEN
    SELECT COUNT(*),
           COALESCE(SUM(ABS(COALESCE("tax", 0)) + ABS(COALESCE("discount", 0))), 0)
      INTO src_count, src_total
      FROM "sales"
     WHERE COALESCE("tax", 0) <> 0 OR COALESCE("discount", 0) <> 0;

    SELECT COUNT(*), COALESCE(SUM(ABS("tax") + ABS("discount")), 0)
      INTO arc_count, arc_total
      FROM "legacy_sale_money";

    IF arc_count < src_count OR arc_total < src_total THEN
      RAISE EXCEPTION
        'Deploy aborted: % sale(s) carrying % of tax/discount are not fully archived (archive holds % row(s) worth %). Refusing to let db push drop sales.tax and sales.discount. Re-run scripts/archive-legacy-money.sql and read the error before retrying.',
        src_count, src_total, arc_count, arc_total;
    END IF;

    RAISE NOTICE
      'Legacy money archive: % sale(s), % of tax/discount preserved in legacy_sale_money — safe to drop the columns.',
      arc_count, arc_total;
  ELSE
    RAISE NOTICE 'sales.tax already retired — nothing to archive this deploy.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'daily_sales_records'
      AND column_name = 'totalDiscount'
  ) THEN
    SELECT COUNT(*), COALESCE(SUM(ABS(COALESCE("totalDiscount", 0))), 0)
      INTO src_count, src_total
      FROM "daily_sales_records"
     WHERE COALESCE("totalDiscount", 0) <> 0;

    SELECT COUNT(*), COALESCE(SUM(ABS("total_discount")), 0)
      INTO arc_count, arc_total
      FROM "legacy_daily_discount";

    IF arc_count < src_count OR arc_total < src_total THEN
      RAISE EXCEPTION
        'Deploy aborted: % daily register record(s) carrying % of discount are not fully archived (archive holds % row(s) worth %). Refusing to let db push drop daily_sales_records.totalDiscount.',
        src_count, src_total, arc_count, arc_total;
    END IF;

    RAISE NOTICE
      'Legacy discount archive: % daily record(s), % preserved in legacy_daily_discount — safe to drop the column.',
      arc_count, arc_total;
  ELSE
    RAISE NOTICE 'daily_sales_records.totalDiscount already retired — nothing to archive this deploy.';
  END IF;
END $$;
