import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const now = new Date()
    const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

    const [recentSales, recentPurchases, recentReturns, lowStockProducts, expiringBatches] =
      await Promise.all([
        // Recent sales (last 10)
        db.sale.findMany({
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
        // Recent purchases (last 5)
        db.purchase.findMany({
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            supplier: { select: { id: true, name: true, phone: true } },
            user: { select: { id: true, name: true } },
          },
        }),
        // Recent returns (last 5)
        db.return.findMany({
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            sale: {
              select: {
                id: true,
                invoiceNo: true,
                customer: { select: { id: true, name: true } },
              },
            },
          },
        }),
        // Low stock products
        db.product.findMany({
          where: { active: true },
          include: {
            batches: { select: { quantity: true } },
          },
        }),
        // Expiring batches
        db.batch.findMany({
          where: {
            expiryDate: { lte: ninetyDaysFromNow },
            quantity: { gt: 0 },
          },
          include: {
            product: { select: { id: true, name: true, reorderLevel: true } },
          },
          orderBy: { expiryDate: 'asc' },
          take: 20,
        }),
      ])

    // Calculate low stock alerts
    const stockAlerts: Array<{
      type: 'low_stock' | 'expiring'
      productId?: string
      batchId?: string
      productName: string
      message: string
      severity: 'warning' | 'danger'
    }> = []

    for (const product of lowStockProducts) {
      const totalQty = product.batches.reduce((sum, b) => sum + b.quantity, 0)
      if (totalQty <= product.reorderLevel) {
        stockAlerts.push({
          type: 'low_stock',
          productId: product.id,
          productName: product.name,
          message: `${product.name} has only ${totalQty} units (reorder level: ${product.reorderLevel})`,
          severity: totalQty === 0 ? 'danger' : 'warning',
        })
      }
    }

    for (const batch of expiringBatches) {
      const daysLeft = Math.ceil(
        (batch.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      )
      stockAlerts.push({
        type: 'expiring',
        batchId: batch.id,
        productId: batch.product.id,
        productName: batch.product.name,
        message: `Batch ${batch.batchNumber} expires in ${daysLeft} days (${batch.quantity} units)`,
        severity: daysLeft <= 30 ? 'danger' : 'warning',
      })
    }

    // Sort alerts by severity
    stockAlerts.sort((a, b) => {
      if (a.severity === 'danger' && b.severity !== 'danger') return -1
      if (a.severity !== 'danger' && b.severity === 'danger') return 1
      return 0
    })

    return NextResponse.json({
      recentSales,
      recentPurchases,
      recentReturns,
      stockAlerts: stockAlerts.slice(0, 20),
    })
  } catch (error) {
    console.error('Dashboard recent error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch recent activity' },
      { status: 500 }
    )
  }
}
