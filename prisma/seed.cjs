const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const db = new PrismaClient();

// See prisma/seed.ts for the rationale: env-driven credentials, a hard refusal
// to seed the published default password in production, and no password reset
// for an owner that already exists.
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'admin@pharmacare.com';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'PharmaCare@2026!';
const OWNER_NAME = process.env.OWNER_NAME || 'Pharmacy Owner';
const USING_DEFAULT_PASSWORD = !process.env.OWNER_PASSWORD;

const isProduction =
  process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
if (isProduction && USING_DEFAULT_PASSWORD) {
  throw new Error(
    'Refusing to seed the default owner password in production. ' +
      'Set OWNER_EMAIL and OWNER_PASSWORD in the environment before seeding.'
  );
}

async function main() {
  console.log('🌱 Seeding database...');

  // Single admin/owner account — no demo users ship with the product.
  const ownerHash = await bcrypt.hash(OWNER_PASSWORD, 12);

  const owner = await db.user.upsert({
    where: { email: OWNER_EMAIL },
    update: { active: true, role: 'admin' },
    create: {
      name: OWNER_NAME,
      email: OWNER_EMAIL,
      password: ownerHash,
      role: 'admin',
      phone: '',
      active: true,
      mustChangePassword: USING_DEFAULT_PASSWORD,
    },
  });

  console.log('✅ Owner: ' + owner.email);
  if (USING_DEFAULT_PASSWORD) {
    console.log('⚠️  Using the default owner password — change it at first sign-in.');
  }

  const categories = ['Analgesics', 'Antibiotics', 'Antivirals', 'Vitamins & Supplements', 'Antifungals'];
  for (const name of categories) {
    await db.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log('✅ ' + categories.length + ' categories seeded');

  const settings = [
    { key: 'pharmacy.appName', value: 'PharmaCare Pro' },
    { key: 'pharmacy.tagline', value: 'Premium Pharmacy Management System' },
    { key: 'pharmacy.currency', value: 'GHS' },
  ];
  for (const s of settings) {
    await db.systemSetting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: s,
    });
  }
  console.log('✅ System settings seeded');

  console.log('\n🎉 Database ready!');
  console.log('   Owner → ' + OWNER_EMAIL);
}

main()
  .catch(function(e) { console.error(e); process.exit(1); })
  .finally(function() { return db.$disconnect(); });
