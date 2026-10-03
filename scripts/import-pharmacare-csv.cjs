/*
 * PharmaCare Pro — CSV Import for pharmacare-products-and-prices.csv
 * Imports products with full pricing, stock, batches, and expiry dates.
 * Idempotent: skips existing products by name (preserves your manual edits).
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const CSV_PATH = path.join(__dirname, '..', 'pharmacare-products-and-prices.csv');
const db = new PrismaClient();

function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = lines[0].split('\t').map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols.length < headers.length) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = cols[idx]?.trim() || ''; });
    rows.push(row);
  }
  return rows;
}

function toNum(v) {
  if (!v) return 0;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function toInt(v, fallback = 0) {
  const n = toNum(v);
  return Number.isInteger(n) ? n : fallback;
}

function parseDate(d) {
  if (!d) return null;
  const parts = d.split('/');
  if (parts.length === 3) {
    return new Date(`${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`);
  }
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
}

async function main() {
  console.log('\n  PharmaCare Pro — CSV Product Import');
  
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`  ❌ CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }

  // Batches are owned by exactly one branch and `branchId` is NOT NULL, so the
  // opening stock imported below has to belong to a specific branch. Required
  // rather than guessed: defaulting to "the first branch" would file one
  // pharmacy's stock on another branch's shelf.
  const branchCode = String(process.env.TARGET_BRANCH_CODE ?? '').trim();
  if (!branchCode) {
    console.error(
      '  ❌ TARGET_BRANCH_CODE is required — the Branch.code that should own the imported stock batches.'
    );
    process.exit(1);
  }
  const branch = await db.branch.findUnique({ where: { code: branchCode } });
  if (!branch) {
    const known = (await db.branch.findMany({ select: { code: true } })).map((b) => b.code).join(', ');
    console.error(`  ❌ No branch with code "${branchCode}". Existing codes: ${known || '(none)'}`);
    process.exit(1);
  }
  console.log(`  Target branch: ${branch.name} (${branch.code})`);

  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(raw);
  console.log(`  Loaded ${rows.length} rows from CSV\n`);

  let created = 0, skipped = 0, updated = 0, errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = row.name;
    const categoryName = row.category || '';
    const genericName = row.genericName || '';
    const unit = row.unit || 'units';
    const stockQty = toInt(row.stockQuantity, 0);
    const reorderLevel = toInt(row.reorderLevel, 10);
    const costPrice = toNum(row.costPrice);
    const sellingPrice = toNum(row.sellingPrice);
    const expiryDate = parseDate(row.expiryDate);
    const active = (row.active || 'yes').toLowerCase() === 'yes';
    const batchNumber = row.batchNumber || `STOCK-${String(i+1).padStart(4,'0')}`;

    if (!name) {
      console.log(`  ⚠️  Row ${i+1}: empty name, skipping`);
      errors++;
      continue;
    }

    try {
      // Resolve/create category
      let categoryId = null;
      if (categoryName) {
        let cat = await db.category.findFirst({ where: { name: categoryName } });
        if (!cat) {
          cat = await db.category.create({ data: { name: categoryName } });
          console.log(`  🗂️  Created category: ${categoryName}`);
        }
        categoryId = cat.id;
      }

      // Check existing product
      let product = await db.product.findFirst({ where: { name } });

      if (product) {
        // Update prices/stock on existing product (preserve your edits)
        await db.product.update({
          where: { id: product.id },
          data: {
            genericName: genericName || null,
            categoryId,
            unit,
            reorderLevel,
            defaultCostPrice: costPrice,
            defaultSellingPrice: sellingPrice,
            active,
          }
        });
        
        // Upsert batch with current stock/prices.
        // Compound key is (productId, batchNumber, branchId): a supplier delivery
        // can exist in two branches, so the branch is part of the identity. The
        // old `productId_batchNumber` selector no longer exists in the schema,
        // and leaving out branchId violates NOT NULL — so every row of this
        // import used to fail while the script still reported success.
        await db.batch.upsert({
          where: {
            productId_batchNumber_branchId: {
              productId: product.id,
              batchNumber,
              branchId: branch.id,
            },
          },
          create: {
            productId: product.id,
            branchId: branch.id,
            batchNumber,
            quantity: stockQty,
            costPrice,
            sellingPrice,
            expiryDate: expiryDate || new Date('2099-12-31'),
          },
          update: {
            quantity: stockQty,
            costPrice,
            sellingPrice,
            ...(expiryDate ? { expiryDate } : {}),
          }
        });
        skipped++;
      } else {
        // Create new product with batch
        product = await db.product.create({
          data: {
            name,
            genericName: genericName || null,
            categoryId,
            unit,
            reorderLevel,
            defaultCostPrice: costPrice,
            defaultSellingPrice: sellingPrice,
            active,
          }
        });
        
        await db.batch.create({
          data: {
            productId: product.id,
            branchId: branch.id,
            batchNumber,
            quantity: stockQty,
            costPrice,
            sellingPrice,
            expiryDate: expiryDate || new Date('2099-12-31'),
          }
        });
        created++;
      }

      if ((created + skipped) % 50 === 0) {
        console.log(`  Processed ${created + skipped}/${rows.length}...`);
      }
    } catch (err) {
      console.error(`  ❌ Row ${i+1} (${name}): ${err.message}`);
      errors++;
    }
  }

  console.log(`\n  ✅ Import complete:`);
  console.log(`     Created: ${created}`);
  console.log(`     Updated: ${skipped}`);
  console.log(`     Errors:  ${errors}\n`);

  await db.$disconnect();

  // Fail loudly if anything went wrong. Row errors are caught per-row so one bad
  // row does not abort the run, which previously meant a completely failed
  // import still exited 0 — an operator had no way to tell "nothing imported"
  // from "nothing to import".
  if (errors > 0) {
    console.error(`  ❌ ${errors} row(s) failed. Re-run after fixing the cause.`);
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('  Fatal:', err);
  process.exit(1);
});