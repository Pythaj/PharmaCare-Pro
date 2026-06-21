import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({ log: [] });

async function seed() {
  console.log('Seeding database...');

  // Categories
  const catData = [
    'Pain Relief', 'Antibiotics', 'Antimalarials', 'Vitamins & Supplements',
    'Cardiovascular', 'Gastrointestinal', 'Respiratory', 'Diabetes', 'Skin Care', 'Eye Care'
  ];
  const categories: Record<string, string> = {};
  for (const name of catData) {
    const c = await db.category.upsert({ where: { name }, update: {}, create: { name } });
    categories[name] = c.id;
  }

  // Suppliers
  const supData = [
    { id: 'sup1', name: 'PharmaCorp Distributors', contact: 'James Mensah', phone: '+233-20-123-4567' },
    { id: 'sup2', name: 'MedSupply West Africa', contact: 'Amina Osei', phone: '+233-24-987-6543' },
    { id: 'sup3', name: 'Global Pharma Imports', contact: 'Kwame Asante', phone: '+233-30-555-7890' },
  ];
  for (const s of supData) {
    await db.supplier.upsert({ where: { id: s.id }, update: {}, create: s });
  }

  // Users
  const admin = await db.user.upsert({
    where: { email: 'admin@pharmacy.com' },
    update: {},
    create: { name: 'Dr. Kwame Owusu', email: 'admin@pharmacy.com', password: 'admin123', role: 'admin', phone: '+233-20-000-0001' },
  });
  const sales1 = await db.user.upsert({
    where: { email: 'cashier@pharmacy.com' },
    update: {},
    create: { name: 'Ama Adjei', email: 'cashier@pharmacy.com', password: 'sales123', role: 'sales', phone: '+233-20-000-0002' },
  });
  const sales2 = await db.user.upsert({
    where: { email: 'attendant@pharmacy.com' },
    update: {},
    create: { name: 'Kofi Boateng', email: 'attendant@pharmacy.com', password: 'sales123', role: 'sales', phone: '+233-20-000-0003' },
  });

  // Products
  const prodData = [
    { name: 'Paracetamol 500mg', cat: 'Pain Relief', unit: 'tablets', reorder: 50 },
    { name: 'Ibuprofen 400mg', cat: 'Pain Relief', unit: 'tablets', reorder: 40 },
    { name: 'Amoxicillin 500mg', cat: 'Antibiotics', unit: 'capsules', reorder: 30 },
    { name: 'Ciprofloxacin 500mg', cat: 'Antibiotics', unit: 'tablets', reorder: 25 },
    { name: 'Artemether-Lumefantrine', cat: 'Antimalarials', unit: 'tablets', reorder: 60 },
    { name: 'Vitamin C 1000mg', cat: 'Vitamins & Supplements', unit: 'tablets', reorder: 100 },
    { name: 'Multivitamin Complex', cat: 'Vitamins & Supplements', unit: 'tablets', reorder: 80 },
    { name: 'Amlodipine 5mg', cat: 'Cardiovascular', unit: 'tablets', reorder: 30 },
    { name: 'Omeprazole 20mg', cat: 'Gastrointestinal', unit: 'capsules', reorder: 40 },
    { name: 'Metformin 500mg', cat: 'Diabetes', unit: 'tablets', reorder: 50 },
    { name: 'Cetirizine 10mg', cat: 'Respiratory', unit: 'tablets', reorder: 60 },
    { name: 'Azithromycin 250mg', cat: 'Antibiotics', unit: 'tablets', reorder: 20 },
    { name: 'Oral Rehydration Salts', cat: 'Gastrointestinal', unit: 'sachets', reorder: 100 },
    { name: 'Diclofenac Gel 30g', cat: 'Pain Relief', unit: 'tubes', reorder: 30 },
    { name: 'Salbutamol Inhaler', cat: 'Respiratory', unit: 'units', reorder: 15 },
  ];

  const products: { id: string; name: string; cost: number; sell: number; qty: number }[] = [];
  const batchInfo = [
    { cost: 0.05, sell: 0.15, qty: 200 }, { cost: 0.08, sell: 0.25, qty: 100 },
    { cost: 0.15, sell: 0.45, qty: 80 }, { cost: 0.20, sell: 0.55, qty: 60 },
    { cost: 0.80, sell: 2.50, qty: 120 }, { cost: 0.03, sell: 0.12, qty: 300 },
    { cost: 0.10, sell: 0.35, qty: 150 }, { cost: 0.12, sell: 0.40, qty: 50 },
    { cost: 0.08, sell: 0.30, qty: 80 }, { cost: 0.06, sell: 0.20, qty: 70 },
    { cost: 0.05, sell: 0.18, qty: 90 }, { cost: 0.30, sell: 0.85, qty: 30 },
    { cost: 0.10, sell: 0.30, qty: 200 }, { cost: 1.50, sell: 4.00, qty: 40 },
    { cost: 2.00, sell: 6.50, qty: 12 },
  ];

  for (let i = 0; i < prodData.length; i++) {
    const p = prodData[i];
    const b = batchInfo[i];
    const prod = await db.product.create({
      data: {
        name: p.name,
        categoryId: categories[p.cat],
        unit: p.unit,
        reorderLevel: p.reorder,
      },
    });
    const expDate = new Date();
    expDate.setMonth(expDate.getMonth() + 18);
    await db.batch.create({
      data: {
        productId: prod.id,
        batchNumber: `BATCH-${String(i + 1).padStart(3, '0')}`,
        quantity: b.qty,
        costPrice: b.cost,
        sellingPrice: b.sell,
        expiryDate: expDate,
      },
    });
    products.push({ id: prod.id, name: p.name, cost: b.cost, sell: b.sell, qty: b.qty });
  }

  // Customers
  const custData = [
    { id: 'cust1', name: 'Esi Mensah', phone: '+233-24-555-1234' },
    { id: 'cust2', name: 'Kwabena Darko', phone: '+233-20-666-7890' },
    { id: 'cust3', name: 'Nana Akua', phone: '+233-50-333-4567' },
    { id: 'cust4', name: 'Yao Tameklo', phone: '+233-27-888-0123' },
    { id: 'cust5', name: 'Fatima Alhassan', phone: '+233-23-444-5678' },
  ];
  for (const c of custData) {
    await db.customer.upsert({ where: { id: c.id }, update: {}, create: c });
  }

  // Sales (last 14 days, fewer per day)
  const now = new Date();
  const users = [sales1, sales2];
  const methods = ['cash', 'card', 'mobile_money'];

  for (let day = 0; day < 14; day++) {
    const numSales = Math.floor(Math.random() * 4) + 2;
    for (let s = 0; s < numSales; s++) {
      const d = new Date(now);
      d.setDate(d.getDate() - day);
      d.setHours(8 + Math.floor(Math.random() * 10));

      const numItems = Math.floor(Math.random() * 3) + 1;
      let subtotal = 0;
      let cost = 0;
      const items = [];
      const used = new Set<number>();

      for (let i = 0; i < numItems && i < products.length; i++) {
        let idx: number;
        do { idx = Math.floor(Math.random() * Math.min(8, products.length)); } while (used.has(idx));
        used.add(idx);
        const p = products[idx];
        const qty = Math.floor(Math.random() * 5) + 1;
        const total = qty * p.sell;
        items.push({
          productId: p.id,
          quantity: qty,
          unitPrice: p.sell,
          costPrice: p.cost,
          total,
        });
        subtotal += total;
        cost += qty * p.cost;
      }

      if (items.length === 0) continue;

      const invNo = `SL-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(s + 1).padStart(3, '0')}`;
      const user = users[Math.floor(Math.random() * 2)];
      const custId = Math.random() > 0.4 ? custData[Math.floor(Math.random() * custData.length)].id : null;

      await db.sale.create({
        data: {
          invoiceNo: invNo,
          customerId: custId,
          userId: user.id,
          subtotal,
          tax: 0,
          discount: Math.random() > 0.8 ? subtotal * 0.05 : 0,
          totalAmount: subtotal - (Math.random() > 0.8 ? subtotal * 0.05 : 0),
          profit: subtotal - cost,
          paymentMethod: methods[Math.floor(Math.random() * 3)],
          status: 'completed',
          createdAt: d,
          items: { create: items },
        },
      });
    }
  }

  // Audit logs
  await db.auditLog.createMany({
    data: [
      { userId: admin.id, action: 'LOGIN', entity: 'User', details: 'Admin logged in', createdAt: new Date(now.getTime() - 3600000) },
      { userId: sales1.id, action: 'SALE_COMPLETE', entity: 'Sale', details: 'Completed POS sale', createdAt: new Date(now.getTime() - 7200000) },
      { userId: sales2.id, action: 'STOCK_RECEIVED', entity: 'Purchase', details: 'New stock received', createdAt: new Date(now.getTime() - 10800000) },
    ],
  });

  console.log('✅ Database seeded successfully!');
  console.log('\n🔐 Login Credentials:');
  console.log('  Admin: admin@pharmacy.com / admin123');
  console.log('  Sales: cashier@pharmacy.com / sales123');
}

seed().catch(console.error).finally(() => db.$disconnect());
