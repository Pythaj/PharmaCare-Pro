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
 * @param {import('@prisma/client').PrismaClient} db
 * @returns {Promise<{ created: number; skipped: number; categoriesCreated: number; errors: Array<{ row: number; name: string; message: string }> }>}
 */
async function importDrugCatalog(db) {
  const rows = loadCatalog();
  const counts = { created: 0, skipped: 0, categoriesCreated: 0 };
  const errors = [];

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

      // Skip products that already exist (idempotent import). When the product
      // exists we still leave its existing category/stock untouched.
      const existing = await db.product.findFirst({ where: { name: row.name } });
      if (existing) {
        counts.skipped += 1;
        continue;
      }

      const product = await db.product.create({
        data: {
          name: row.name,
          categoryId,
          unit: row.unit,
          reorderLevel: row.reorderLevel,
        },
      });

      // Starter batch so the drug has stock on hand and can be sold in the POS.
      const expiryDate = new Date();
      expiryDate.setMonth(expiryDate.getMonth() + DEFAULT.expiryOffsetMonths);

      await db.batch.create({
        data: {
          productId: product.id,
          batchNumber: DEFAULT.batchNumber,
          quantity: DEFAULT.quantity,
          costPrice: DEFAULT.costPrice,
          sellingPrice: DEFAULT.sellingPrice,
          expiryDate,
        },
      });

      counts.created += 1;
    } catch (err) {
      errors.push({
        row: i + 1,
        name: row.name,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return { ...counts, errors };
}

async function main() {
  const db = new PrismaClient({ log: [] });
  const rows = loadCatalog();

  console.log(`\n  PharmaCare Pro — Drug Catalog Import`);
  console.log(`  Loading ${rows.length} drugs from drug-catalog.json\n`);

  try {
    const { created, skipped, categoriesCreated, errors } = await importDrugCatalog(db);

    console.log(`  ✅ ${created} drugs created`);
    console.log(`  ⏭️  ${skipped} already existed (skipped)`);
    console.log(`  🗂️  ${categoriesCreated} new categories created`);
    if (errors.length > 0) {
      console.log(`  ⚠️  ${errors.length} error(s):`);
      for (const e of errors.slice(0, 20)) {
        console.log(`     - [row ${e.row}] ${e.name}: ${e.message}`);
      }
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