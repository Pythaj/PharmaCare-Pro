/*
 * PharmaCare Pro — Desktop seed script (plain CommonJS).
 *
 * Used at BUILD time to pre-populate the shipped SQLite template. The template
 * includes the default owner login AND the full pharmacy drug catalog (the same
 * single source of truth used by the dev import — Rule 18), so an installed
 * desktop copy starts with the owner's complete standard stock list already in
 * place and only its real quantities/prices need to be entered.
 *
 * Run with:
 *   DATABASE_URL="file:<abs path>/template.db" node scripts/desktop-seed.cjs
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { importDrugCatalog } = require('./import-drugs.cjs');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required (file:... template path)');
  }
  console.log('\n  Seeding owner account (desktop template)...');
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

  try {
    const ownerHash = await bcrypt.hash('PharmaCare@2026!', 12);

    const owner = await db.user.upsert({
      where: { email: 'admin@pharmacare.com' },
      update: { password: ownerHash, active: true, role: 'admin' },
      create: {
        name: 'Pharmacy Owner',
        email: 'admin@pharmacare.com',
        password: ownerHash,
        role: 'admin',
        phone: '',
        active: true,
      },
    });

    console.log(`    admin@pharmacare.com (${owner.role})`);

    // Full drug catalog — the same routine that populates the dev database, so
    // both environments ship identical standard stock (Rule 18). Idempotent.
    const { created, skipped, categoriesCreated, errors } = await importDrugCatalog(db);
    console.log(`  Drug catalog seeder:`);
    console.log(`    ${created} drugs created`);
    console.log(`    ${skipped} already existed (skipped)`);
    console.log(`    ${categoriesCreated} categories created`);
    if (errors.length > 0) {
      console.log(`    ⚠️  ${errors.length} error(s):`);
      for (const e of errors.slice(0, 10)) {
        console.log(`       - ${e.name}: ${e.message}`);
      }
    }

    console.log('  Seed complete.\n');
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error('  Seed failed:', err.message);
  process.exit(1);
});