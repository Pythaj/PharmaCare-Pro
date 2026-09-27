import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireBranchScope } from '@/lib/require-auth'
import { branchRelationWhere, branchWhere } from '@/lib/branches'
import { classifyBatchExpiry, classifyStock, daysUntil } from '@/lib/inventory-alerts'

/**
 * GET /api/dashboard/recent
 *
 * Sales list scoped by role (cashiers see their own recent sales), and stock
 * alerts standardised against lib/inventory-alerts so the numbers match the
 * other dashboard panels. The alert payload carries a stable composite key (so
 * the UI never uses productId alone when two batches of the same product are
 * both expiring), a real quantity/reorderLevel instead of a message the client
 * has to regex, and splits "expired" from "expiring soon".
 *
 * Sale, purchase and return activity is all scoped by role: an admin sees
 * company-wide money data, a cashier sees only the rows they created
 * themselves. Nothing a cashier did not personally enter can reach their
 * session — no other cashier's sales, refunds or supplier costs. (A cashier
 * still sees their own purchase totals, but they supplied those when they
 * recorded the purchase, so this discloses nothing they did not already know.)
 */
export async function GET(request: NextRequest) {
  const auth = await requireBranchScope(request)
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const now = new Date()

    const isAdmin = auth.user!.role === 'admin'
    const branchScope = branchWhere(auth.scope!)
    const saleScope = isAdmin ? branchScope : { ...branchScope, userId: auth.user!.userId }
    // Return has no branch of its own — it inherits one from the sale it
    // refunds, so its boundary has to be expressed as a relation filter.
    const returnScope = isAdmin
      ? branchRelationWhere(auth.scope!, 'sale')
      : { ...branchRelationWhere(auth.scope!, 'sale'), userId: auth.user!.userId }

    const [recentSales, recentPurchases, recentReturns, products] = await Promise.all([
      db.sale.findMany({
        where: saleScope,
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
          customer: { select: { id: true, name: true, phone: true } },
          items: {
            include: {
              product: { select: { id: true, name: true } },
            },
          },
        },
      }),
      db.purchase.findMany({
        where: isAdmin ? branchScope : { ...branchScope, userId: auth.user!.userId },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          supplier: { select: { id: true, name: true, phone: true } },
          user: { select: { id: true, name: true } },
        },
      }),
      db.return.findMany({
        where: returnScope,
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          sale: {
            select: {
              id: true,
              invoiceNo: true,
              branchId: true,
              branch: { select: { id: true, name: true, code: true } },
              customer: { select: { id: true, name: true } },
            },
          },
          user: { select: { id: true, name: true } },
        },
      }),
      db.product.findMany({
        where: { active: true },
        include: {
          // Scoped to the session's branch. This nested list was the reason a
          // salesperson on Branch A was told Amoxil was "out of stock" purely
          // because Branch B had cleared its shelf — a reorder prompt for stock
          // this shop neither holds nor can reorder.
          batches: {
            where: branchWhere(auth.scope!),
            select: { id: true, batchNumber: true, quantity: true, expiryDate: true },
          },
        },
      }),
    ])

    const stockAlerts: Array<{
      type: 'low_stock' | 'out_of_stock' | 'expiring' | 'expired'
      key: string
      productId: string
      batchId?: string
      productName: string
      message: string
      severity: 'warning' | 'danger'
      quantity: number
      /** Sent for the stock alerts so the UI never has to parse the message. */
      reorderLevel?: number
      expiryDate?: string
    }> = []

    for (const product of products) {
      const batches = product.batches.filter((b) => b.quantity > 0)
      const totalQty = batches.reduce((sum, b) => sum + b.quantity, 0)
      const stockStatus = classifyStock(totalQty, product.reorderLevel)

      if (stockStatus === 'out_of_stock') {
        stockAlerts.push({
          type: 'out_of_stock',
          key: `${product.id}:out`,
          productId: product.id,
          productName: product.name,
          message: `${product.name} is out of stock`,
          severity: 'danger',
          quantity: 0,
          reorderLevel: product.reorderLevel,
        })
      } else if (stockStatus === 'low_stock') {
        stockAlerts.push({
          type: 'low_stock',
          key: `${product.id}:low`,
          productId: product.id,
          productName: product.name,
          message: `${product.name} has only ${totalQty} units (reorder level: ${product.reorderLevel})`,
          severity: 'warning',
          quantity: totalQty,
          reorderLevel: product.reorderLevel,
        })
      }

      // Expiry per batch: expired trumps the product-level "expiring soon".
      for (const batch of batches) {
        const status = classifyBatchExpiry(batch.expiryDate, now)
        if (status === 'good') continue

        const daysLeft = daysUntil(batch.expiryDate, now)
        const isExpired = status === 'expired'
        stockAlerts.push({
          type: isExpired ? 'expired' : 'expiring',
          key: `${product.id}:${batch.id}:${status}`,
          productId: product.id,
          batchId: batch.id,
          productName: product.name,
          message: isExpired
            ? `Batch ${batch.batchNumber} expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago (${batch.quantity} units)`
            : `Batch ${batch.batchNumber} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${batch.quantity} units)`,
          severity: isExpired || daysLeft <= 30 ? 'danger' : 'warning',
          quantity: batch.quantity,
          expiryDate: batch.expiryDate.toISOString(),
        })
      }
    }

    stockAlerts.sort((a, b) => {
      if (a.severity === 'danger' && b.severity !== 'danger') return -1
      if (a.severity !== 'danger' && b.severity === 'danger') return 1
      return 0
    })

    return NextResponse.json({
      scope: isAdmin ? (auth.scope!.branchId ? 'branch' : 'all') : 'own',
      branchId: auth.scope!.branchId,
      recentSales: recentSales.map((s) => ({
        ...s,
        subtotal: Number(s.subtotal),
        tax: Number(s.tax),
        discount: Number(s.discount),
        totalAmount: Number(s.totalAmount),
        profit: Number(s.profit),
        items: s.items.map((item) => ({
          ...item,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          costPrice: Number(item.costPrice),
          total: Number(item.total),
        })),
      })),
      recentPurchases,
      recentReturns,
      stockAlerts: stockAlerts.slice(0, 50),
    })
  } catch (error) {
    console.error('Dashboard recent error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch recent activity' },
      { status: 500 }
    )
  }
}
