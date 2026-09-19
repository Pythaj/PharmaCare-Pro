const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const db = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Single admin/owner account — no demo users ship with the product.
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

  console.log('✅ Owner: ' + owner.email);

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
    { key: 'pharmacy.taxRate', value: '0' },
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
  console.log('   Owner → admin@pharmacare.com');
}

main()
  .catch(function(e) { console.error(e); process.exit(1); })
  .finally(function() { return db.$disconnect(); });
