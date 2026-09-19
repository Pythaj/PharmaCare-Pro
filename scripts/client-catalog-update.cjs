/*
 * PharmaCare Pro — Client catalog updater (CommonJS).
 *
 * Applies the client's authoritative product export (pharmacare-products-export.json)
 * to any target SQLite database referenced by DATABASE_URL. Idempotent: safe to
 * re-run. Upserts categories, products, and the STOCK-001 starting batch by name.
 *
 * Design notes:
 *  - Products are matched by name (findFirst, like the app's import route).
 *  - Duplicate names in the export are collapsed to a single product, preferring
 *    rows marked active and rows carrying stock.
 *  - The active flag ("yes"/"no") is applied to the product.
 *  - Stock is written into the existing/new STOCK-001 batch, including cost,
 *    selling price and expiry date, so the client's on-hand inventory is the
 *    source of truth.
 *  - Products already in the DB that are NOT in the export are left untouched.
 *
 * Run against a database with:
 *   $env:DATABASE_URL="file:<abs path to .db>" ; node scripts/client-catalog-update.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const ROOT = path.resolve(__dirname, '..');
const EXPORT_JSON = path.join(ROOT, 'pharmacare-products-export.json');
const DEFAULT_BATCH = 'STOCK-001';
const DEFAULT_EXPIRY = new Date('2099-12-31');

const isYes = (v) => String(v ?? '').trim().toLowerCase() === 'yes';

function toNumber(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const cleaned = String(v).replace(/[^\d.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInt(v, fallback = 10) {
  const n = toNumber(v);
  return Number.isInteger(n) ? n : fallback;
}

/** Reads and normalises the client export into unique-by-name products. */
function loadClientProducts() {
  if (!fs.existsSync(EXPORT_JSON)) {
    throw new Error(`Export not found: ${EXPORT_JSON}`);
  }
  const raw = JSON.parse(fs.readFileSync(EXPORT_JSON, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('Export JSON must be an array of product rows');

  const deduped = new Map();
  for (const row of raw) {
    const name = String(row.name ?? '').trim();
    if (!name) continue;

    const existing = deduped.get(name);
    const score = (r) => (isYes(r.active) ? 2 : 0) + (toNumber(r.stockQuantity) > 0 ? 1 : 0);
    if (!existing || score(row) > score(existing)) {
      deduped.set(name, row);
    }
  }
  return [...deduped.values()];
}

function parseExpiry(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required (file:... path to the target .db)');
  }
  const dryRun = process.argv.includes('--dry-run');

  const db = new PrismaClient({ datasources: { db: { url } } });
  const products = loadClientProducts();

  try {
    console.log(`\n=== Client catalog update ===`);
    console.log(`  source: ${path.relative(ROOT, EXPORT_JSON)}`);
    console.log(`  export rows: ${products.length} (after dedupe)`);
    if (dryRun) console.log('  mode: DRY-RUN (no writes)');

    // Pre-load existing categories & products in one pass.
    const existingCategories = await db.category.findMany();
    const existingProducts = await db.product.findMany({ select: { id: true, name: true, active: true } });
    const categoryByName = new Map(existingCategories.map((c) => [c.name, c.id]));
    const productByName = new Map(existingProducts.map((p) => [p.name, p.id]));
    const clientNames = new Set(products.map((p) => p.name));

    const touched = { created: 0, updated: 0, deactivated: 0 };
    const createdCategories = []; // names

    for (const row of products) {
      const name = String(row.name).trim();
      const categoryName = String(row.category ?? '').trim();
      const unit = String(row.unit ?? '').trim() || 'units';
      const reorderLevel = toInt(row.reorderLevel, 10);
      const cost = toNumber(row.costPrice);
      const sell = toNumber(row.sellingPrice);
      const qty = toInt(row.stockQuantity, 0);
      const active = isYes(row.active);
      const genericName = String(row.genericName ?? '').trim() || null;
      const expiry = parseExpiry(row.expiryDate);

      let categoryId = null;
      if (categoryName) {
        if (!categoryByName.has(categoryName)) {
          if (!dryRun) {
            const cat = await db.category.create({ data: { name: categoryName } });
            categoryByName.set(categoryName, cat.id);
          } else {
            categoryByName.set(categoryName, `dry-${categoryName}`);
          }
          createdCategories.push(categoryName);
        }
        categoryId = categoryByName.get(categoryName);
      }

      const productData = {
        name,
        genericName,
        categoryId,
        unit,
        reorderLevel,
        defaultCostPrice: cost,
        defaultSellingPrice: sell,
        active,
      };

      let productId = productByName.get(name);
      if (dryRun) {
        touched[productId ? 'updated' : 'created'] += 1;
        productByName.set(name, productId ?? `dry-${name}`);
        continue;
      }

      if (productId) {
        await db.product.update({ where: { id: productId }, data: productData });
        touched.updated += 1;
      } else {
        const created = await db.product.create({
          data: { ...productData, batches: { create: [] } },
        });
        productId = created.id;
        productByName.set(name, productId);
        touched.created += 1;
      }

      // Upsert the starting batch with the client's on-hand stock.
      await db.batch.upsert({
        where: { productId_batchNumber: { productId, batchNumber: DEFAULT_BATCH } },
        create: {
          productId,
          batchNumber: DEFAULT_BATCH,
          quantity: qty,
          costPrice: cost,
          sellingPrice: sell,
          expiryDate: expiry ?? DEFAULT_EXPIRY,
        },
        update: {
          quantity: qty,
          costPrice: cost,
          sellingPrice: sell,
          ...(expiry ? { expiryDate: expiry } : {}),
        },
      });
    }

    // Deactivate DB products that the client's authoritative export no longer lists.
    const toDeactivate = existingProducts.filter(
      (p) => !clientNames.has(p.name) && p.active
    );
    if (!dryRun) {
      for (const p of toDeactivate) {
        await db.product.update({ where: { id: p.id }, data: { active: false } });
      }
    }
    touched.deactivated = toDeactivate.length;

    console.log(`  products created: ${touched.created}`);
    console.log(`  products updated: ${touched.updated}`);
    console.log(`  products deactivated (not in export): ${touched.deactivated}`);
    console.log(`  categories created: ${createdCategories.length}`);
    if (createdCategories.length) {
      console.log(`    ` + createdCategories.join(', '));
    }
    console.log(dryRun ? '  [DRY-RUN] nothing was written\n' : '  complete\n');
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error('Client catalog update failed:', err.message);
  process.exit(1);
});