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
        
        // Upsert batch with current stock/prices
        await db.batch.upsert({
          where: { productId_batchNumber: { productId: product.id, batchNumber } },
          create: {
            productId: product.id,
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
}

main().catch(err => {
  console.error('  Fatal:', err);
  process.exit(1);
});