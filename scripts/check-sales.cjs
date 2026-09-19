const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

db.sale.findMany({ 
  orderBy: { createdAt: 'desc' }, 
  take: 10,
  include: { items: true }
}).then(sales => {
  console.log('Recent sales:');
  sales.forEach(s => console.log(s.invoiceNo, new Date(s.createdAt).toLocaleDateString(), 'total:', s.totalAmount, 'profit:', s.profit, 'items:', s.items.length));
  db.$disconnect();
}).catch(e => console.error(e));