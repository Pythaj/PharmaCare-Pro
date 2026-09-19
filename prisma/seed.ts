import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();

const OWNER_EMAIL = 'admin@pharmacare.com';
const OWNER_PASSWORD = 'PharmaCare@2026!';

async function main() {
  console.log('🌱 Seeding database...');

  // Single admin/owner account — no demo users ship with the product.
  const ownerHash = await bcrypt.hash(OWNER_PASSWORD, 12);

  const owner = await db.user.upsert({
    where: { email: OWNER_EMAIL },
    update: { password: ownerHash, active: true, role: 'admin' },
    create: {
      name: 'Pharmacy Owner',
      email: OWNER_EMAIL,
      password: ownerHash,
      role: 'admin',
      phone: '',
      active: true,
      mustChangePassword: true,
    },
  });

  console.log(`✅ Owner: ${owner.email}`);

  // Seed a few categories
  const categories = ['Analgesics', 'Antibiotics', 'Antivirals', 'Vitamins & Supplements', 'Antifungals'];
  for (const name of categories) {
    await db.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`✅ ${categories.length} categories seeded`);

  // System settings
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
  console.log(`✅ System settings seeded`);

  console.log('\n🎉 Database ready! Owner account:');
  console.log('   admin@pharmacare.com');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
