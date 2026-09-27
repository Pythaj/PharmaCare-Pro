/*
 * PharmaCare Pro — Drug Catalog Import (CommonJS).
 *
 * Imports the full pharmacy drug catalog from scripts/drug-catalog.json into
 * a database. This JSON is the single source of truth for the pharmacy's
 * standard stock list (Rule 18). Products are created under their therapeutic
 * category (categories are auto-created when missing, mirroring the app's bulk
 * import route in src/app/api/products/import/route.ts) and each product
 * receives a starter batch so it can be sold immediately in the POS.
 *
 * The import is IDEMPOTENT: running it again only creates products that do not
 * already exist (matched by name). Existing products and stock are left intact.
 *
 * This module is shareable — both the standalone CLI and the desktop template
 * seed (scripts/desktop-seed.cjs) use the SAME `importDrugCatalog()` routine so
 * the shipped desktop app and the dev database always agree on the catalog.
 *
 * Run standalone with:
 *   node scripts/import-drugs.cjs
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const CATALOG_PATH = path.join(__dirname, 'drug-catalog.json');

/** Default stock/pricing applied to every drug unless overridden per row.
  * Per the owner's decision, starting stock is 0 — the real quantity is entered
  * by the owner through the Edit Drug dialog, never seeded as demo stock.
  * Prices likewise stay 0 until the owner sets them. */
const DEFAULT = {
  quantity: 0,
  batchNumber: 'STOCK-001',
  costPrice: 0,
  sellingPrice: 0,
  expiryOffsetMonths: 24,
};

/** Ensure a starter batch exists for each (product, branch) pair.
  *
  * This is the CommonJS twin of src/lib/catalogue-seeding.ts, which does the same
  * job inside the running app. It exists separately because this file is a
  * build-time tool run by plain `node` with no TypeScript loader available, while
  * the app imports the TS module directly. Both must keep the same contract:
  *
  *   - the batch number is DEFAULT.batchNumber ('STOCK-001');
  *   - a seeded batch always has quantity 0, so importing can never invent
  *     stock that was never counted;
  *   - a seeded batch is priced at the product's CURRENT catalogue price, never
  *     0 — the POS charges min(batch.sellingPrice) and a quantity-only batch
  *     adjustment is allowed, so a 0-priced starter batch would sell the drug
  *     for nothing the first time that branch received stock;
  *   - an existing batch is never modified (see `update: {}`), so real counted
  *     quantities, costs and selling prices survive untouched.
  *
  * If you change one, change the other.
  *
  * @param {object} product needs id, defaultCostPrice, defaultSellingPrice.
  * @returns {Promise<number>} how many branches were seeded for this product. */
async function ensureStarterBatches(db, product, branchIds) {
  const expiryDate = new Date();
  expiryDate.setMonth(expiryDate.getMonth() + DEFAULT.expiryOffsetMonths);

  const productId = product.id;
  // Money columns are Decimal; coerce once, here.
  const costPrice = Number(product.defaultCostPrice ?? DEFAULT.costPrice);
  const sellingPrice = Number(product.defaultSellingPrice ?? DEFAULT.sellingPrice);

  for (const branchId of branchIds) {
    await db.batch.upsert({
      where: {
        productId_batchNumber_branchId: {
          productId,
          batchNumber: DEFAULT.batchNumber,
          branchId,
        },
      },
      create: {
        productId,
        branchId,
        batchNumber: DEFAULT.batchNumber,
        quantity: DEFAULT.quantity,
        costPrice,
        sellingPrice,
        expiryDate,
      },
      // Never touch an existing batch: it holds real counted stock, a real
      // cost and a real selling price that the owner entered.
      update: {},
    });
  }

  return branchIds.length;
}

/** Read and validate the drug catalog. */
function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`Catalog not found: ${CATALOG_PATH}`);
  }
  const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) {
    throw new Error('Catalog must be a JSON array of [name, category, unit, reorderLevel] rows.');
  }
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 4) {
      throw new Error('Each catalog row must be [name, category, unit, reorderLevel].');
    }
    if (typeof row[0] !== 'string' || !row[0].trim()) {
      throw new Error('Product name must be a non-empty string.');
    }
  }
  return rows.map(([name, category, unit, reorderLevel]) => ({
    name: name.trim(),
    category: String(category).trim(),
    unit: String(unit).trim() || 'units',
    reorderLevel: Number.isFinite(Number(reorderLevel)) ? Number(reorderLevel) : 10,
  }));
}

/**
 * Imports the drug catalog into the provided Prisma client.
 * Reused by the standalone CLI and the desktop seed so both stay in sync.
 *
 * A product is GLOBAL: one row in `products`, visible from every branch the
 * moment it exists. What is per-branch is the *stock* — a `Batch` row. So this
 * function creates the product once and then ensures a starter batch exists at
 * every target branch, which is what makes a freshly imported drug show up on
 * a till at every location instead of only the branch that happened to run the
 * import.
 *
 * The starter batch carries quantity 0 by owner decision: the real quantity is
 * entered per branch through the Edit Drug dialog, so importing a catalogue can
 * never invent stock that was never counted.
 *
 * Idempotent AND self-healing. A previous version created the product and then
 * let the batch write fail (it was missing the now-required `branchId`), while
 * the product-existence check meant a retry skipped the row and the missing
 * batch was never repaired — so the catalogue silently stayed empty forever.
 * Here the product lookup and the per-branch batch writes are separate,
 * guarded steps, so re-running always converges on the intended state.
 *
 * @param {import('@prisma/client').PrismaClient} db
 * @param {{ branchIds?: string[] }} [options]
 * @returns {Promise<{ created: number; skipped: number; updated: number; categoriesCreated: number; branchesSeeded: number; swept: number; errors: Array<{ row: number; name: string; message: string }> }>}
 */
async function importDrugCatalog(db, options = {}) {
  const rows = loadCatalog();
  const counts = {
    created: 0,
    skipped: 0,
    updated: 0,
    categoriesCreated: 0,
    branchesSeeded: 0,
  };
  const errors = [];

  // Which branches should carry starter stock. Resolved by the caller; defaults
  // to every active branch so a single import never leaves a location behind.
  const targetBranches =
    options.branchIds && options.branchIds.length > 0
      ? options.branchIds
      : (await db.branch.findMany({ where: { active: true }, select: { id: true } })).map(
          (b) => b.id
        );

  if (targetBranches.length === 0) {
    throw new Error(
      'No active branches exist, so imported drugs would have nowhere to live. Create a branch first.'
    );
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    try {
      // Resolve category by name, auto-creating when missing (same behaviour as
      // the app's bulk import route — Rule 18: one source of truth).
      let categoryId = null;
      const existingCategory = await db.category.findFirst({
        where: { name: row.category },
      });
      if (existingCategory) {
        categoryId = existingCategory.id;
      } else {
        const created = await db.category.create({ data: { name: row.category } });
        categoryId = created.id;
        counts.categoriesCreated += 1;
      }

      // Name is not unique in the schema, so match case-insensitively before
      // deciding to create — otherwise a stray "paracetamol" / "Paracetamol"
      // pair becomes two drugs where the owner believes there is one.
      //
      // Prisma's `mode: 'insensitive'` is PostgreSQL-only and this importer also
      // runs against the SQLite desktop template, where it throws. `contains`
      // plus an exact comparison in JS is case-insensitive on both providers:
      // LIKE is case-insensitive for ASCII in SQLite, and the JS comparison
      // settles the result either way.
      const name = row.name;
      const candidates = await db.product.findMany({
        where: { name: { contains: name } },
        select: {
          id: true,
          name: true,
          categoryId: true,
          defaultCostPrice: true,
          defaultSellingPrice: true,
        },
      });
      const target = name.trim().toLowerCase();
      const existing =
        candidates.find((c) => c.name.trim().toLowerCase() === target) ?? null;

      let product = existing;
      if (existing) {
        counts.skipped += 1;
        // Repair a product that never got its category, without stomping on a
        // category the owner has since set by hand.
        if (!existing.categoryId && categoryId) {
          await db.product.update({ where: { id: existing.id }, data: { categoryId } });
          counts.updated += 1;
        }
      } else {
        product = await db.product.create({
          data: {
            name,
            categoryId,
            unit: row.unit,
            reorderLevel: row.reorderLevel,
          },
        });
        counts.created += 1;
      }

      // Starter batch so the drug is a known, sellable line item at every
      // branch. Idempotent, so a branch added later is back-filled simply by
      // importing again. `product` carries the default prices either way: the
      // find above selects them, and create() returns all scalars.
      counts.branchesSeeded += await ensureStarterBatches(db, product, targetBranches);
    } catch (err) {
      errors.push({
        row: i + 1,
        name: row.name,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  // Final sweep: the loop above only covers the 224 catalogue rows, but a
  // database that has been in use also holds drugs the owner added by hand.
  // Repairing those is what makes "re-run the import" a complete fix rather
  // than a partial one, and it is the offline equivalent of
  // scripts/backfill-catalogue.sql.
  const allProducts = await db.product.findMany({
    select: { id: true, defaultCostPrice: true, defaultSellingPrice: true },
  });
  for (const product of allProducts) {
    try {
      counts.branchesSeeded += await ensureStarterBatches(db, product, targetBranches);
    } catch (err) {
      errors.push({
        row: 0,
        name: `sweep:${product.id}`,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }
  counts.swept = allProducts.length;

  return { ...counts, errors };
}

async function main() {
  const db = new PrismaClient({ log: [] });
  const rows = loadCatalog();

  console.log(`\n  PharmaCare Pro — Drug Catalog Import`);
  console.log(`  Loading ${rows.length} drugs from drug-catalog.json\n`);

  try {
    const { created, skipped, updated, categoriesCreated, branchesSeeded, swept, errors } =
      await importDrugCatalog(db);

    const branches = await db.branch.count({ where: { active: true } });
    console.log(`  ✅ ${created} drugs created`);
    console.log(`  ⏭️  ${skipped} already existed (stock preserved)`);
    if (updated > 0) console.log(`  🔧 ${updated} existing drugs repaired`);
    console.log(`  🗂️  ${categoriesCreated} new categories created`);
    console.log(`  🏪 ${branchesSeeded} product/branch pair(s) ensured across ${branches} branch(es)`);
    console.log(`  🔁 ${swept} product(s) checked for coverage`);

    if (errors.length > 0) {
      console.log(`\n  ⚠️  ${errors.length} row(s) FAILED:`);
      for (const e of errors.slice(0, 20)) {
        console.log(`     - [row ${e.row}] ${e.name}: ${e.message}`);
      }
      if (errors.length > 20) {
        console.log(`     ...and ${errors.length - 20} more`);
      }
      // A partial import is a real failure: the desktop build reads this exit
      // code, and shipping an app whose catalogue is silently empty is exactly
      // the bug this importer had.
      console.log(`\n  Import incomplete.`);
      process.exitCode = 1;
      return;
    }

    console.log(`\n  Import complete.\n`);
  } finally {
    await db.$disconnect();
  }
}

module.exports = { importDrugCatalog, loadCatalog, CATALOG_PATH, DEFAULT };

if (require.main === module) {
  main().catch((err) => {
    console.error('  Import failed:', err.message);
    process.exit(1);
  });
}