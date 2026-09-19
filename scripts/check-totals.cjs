const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

db.sale.aggregate({
  _sum: { totalAmount: true, profit: true }
}).then(r => {
  console.log('ALL TIME totals:', r);
  db.$disconnect();
}).catch(e => console.error(e));