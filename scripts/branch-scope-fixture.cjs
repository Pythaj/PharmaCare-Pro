/**
 * Branch-scope isolation fixture (THROWAWAY TEST DATA — local SQLite only).
 *
 * Creates a second branch ("QA") with one batch, one sale and one return so the
 * isolation test has a foreign row to try to leak. Also creates a throwaway
 * admin with a known password, because the test needs to log in and no existing
 * credential may be guessed or reset.
 *
 * Usage: node scripts/branch-scope-fixture.cjs seed|status|clean
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const db = new PrismaClient();

const QA_BRANCH_CODE = 'QA';
const TEST_EMAIL = 'qa.tester@local.invalid';
const TEST_PASSWORD = 'QaIsolation!2026';
const PREFIX = 'QA-ISO';

async function seed() {
  const password = await bcrypt.hash(TEST_PASSWORD, 10);

  const branch = await db.branch.upsert({
    where: { code: QA_BRANCH_CODE },
    update: {},
    create: { name: 'QA Isolation Branch', code: QA_BRANCH_CODE, active: true },
  });

  const admin = await db.user.upsert({
    where: { email: TEST_EMAIL },
    update: { password, active: true, role: 'admin', branchId: null },
    create: {
      name: 'QA Tester',
      email: TEST_EMAIL,
      password,
      role: 'admin',
      branchId: null,
      mustChangePassword: false,
    },
  });

  const category = await db.category.findFirst();
  const product = await db.product.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!category || !product) throw new Error('Need at least one existing product/category');

  const batch = await db.batch.upsert({
    where: { id: `${PREFIX}-batch` },
    update: {},
    create: {
      id: `${PREFIX}-batch`,
      productId: product.id,
      branchId: branch.id,
      batchNumber: `${PREFIX}-B1`,
      quantity: 42,
      costPrice: 3.5,
      sellingPrice: 8,
      expiryDate: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000),
    },
  });

  const sale = await db.sale.upsert({
    where: { id: `${PREFIX}-sale` },
    update: {},
    create: {
      id: `${PREFIX}-sale`,
      invoiceNo: `${PREFIX}-INV-1`,
      userId: admin.id,
      branchId: branch.id,
      subtotal: 8,
      tax: 0,
      discount: 0,
      totalAmount: 8,
      profit: 4.5,
      status: 'completed',
      paymentMethod: 'cash',
      items: {
        create: {
          productId: product.id,
          batchId: batch.id,
          quantity: 1,
          unitPrice: 8,
          costPrice: 3.5,
          total: 8,
        },
      },
    },
    include: { items: true },
  });

  const ret = await db.return.upsert({
    where: { id: `${PREFIX}-return` },
    update: {},
    create: {
      id: `${PREFIX}-return`,
      saleId: sale.id,
      userId: admin.id,
      reason: 'QA isolation fixture',
      status: 'approved',
      totalRefund: 8,
      items: {
        create: {
          saleItemId: sale.items[0].id,
          quantity: 1,
          refundAmount: 8,
        },
      },
    },
  });

  const main = await db.branch.findFirst({ where: { code: { not: QA_BRANCH_CODE } } });

  console.log(
    JSON.stringify(
      {
        branchId: branch.id,
        branchName: branch.name,
        mainBranchId: main?.id ?? null,
        batchId: batch.id,
        saleId: sale.id,
        returnId: ret.id,
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      },
      null,
      2
    )
  );
}

async function clean() {
  const sale = await db.sale.findUnique({ where: { id: `${PREFIX}-sale` } });
  if (sale) {
    await db.returnItem.deleteMany({ where: { return: { saleId: sale.id } } });
    await db.return.deleteMany({ where: { saleId: sale.id } });
    await db.saleItem.deleteMany({ where: { saleId: sale.id } });
    await db.sale.deleteMany({ where: { id: sale.id } });
  }
  await db.batch.deleteMany({ where: { id: `${PREFIX}-batch` } });
  await db.auditLog.deleteMany({ where: { details: { contains: PREFIX } } });
  await db.user.deleteMany({ where: { email: TEST_EMAIL } });
  await db.branch.deleteMany({ where: { code: QA_BRANCH_CODE } });
  console.log('cleaned');
}

async function status() {
  const branches = await db.branch.findMany({ select: { id: true, name: true, code: true, active: true } });
  console.log(JSON.stringify(branches, null, 2));
}

const cmd = process.argv[2] || 'status';
const map = { seed, clean, status };
if (!map[cmd]) {
  console.error('usage: node scripts/branch-scope-fixture.cjs seed|status|clean');
  process.exit(1);
}
map[cmd]()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
