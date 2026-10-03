import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();

// Credentials are env-driven so a cloud deployment can bootstrap its owner
// without shipping a known password. The literals below are the documented
// first-run defaults for a local/dev database and the desktop template.
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'admin@pharmacare.com';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'PharmaCare@2026!';
const OWNER_NAME = process.env.OWNER_NAME || 'Pharmacy Owner';
// True only while the published default password is in play. Kept so the
// account is forced to change it on first login.
const USING_DEFAULT_PASSWORD = !process.env.OWNER_PASSWORD;

// The default password is in the repository, so it must never bootstrap a
// production owner — anyone reading the source could sign in. Refuse rather
// than quietly create an open account. `OWNER_PASSWORD` (or a proper password
// reset) is required for cloud deployments.
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
    // Deliberately not resetting the password for an existing owner: re-running
    // the seed against a live database would otherwise clobber a password the
    // owner has already changed, back to the published default.
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

  console.log(`✅ Owner: ${owner.email}`);
  if (USING_DEFAULT_PASSWORD) {
    console.log(
      '⚠️  Using the default owner password — change it at first sign-in.'
    );
  }

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
  console.log(`   ${OWNER_EMAIL}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
