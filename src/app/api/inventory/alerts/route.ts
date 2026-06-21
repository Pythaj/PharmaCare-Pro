import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const now = new Date();

    // Fetch all active products with their batches
    const products = await db.product.findMany({
      where: { active: true },
      include: {
        category: { select: { id: true, name: true } },
        batches: {
          select: {
            id: true,
            batchNumber: true,
            quantity: true,
            costPrice: true,
            sellingPrice: true,
            expiryDate: true,
          },
          orderBy: { expiryDate: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    const outOfStock: {
      productId: string;
      productName: string;
      genericName: string | null;
      categoryName: string | null;
      unit: string;
      reorderLevel: number;
      totalStock: number;
    }[] = [];

    const lowStock: {
      productId: string;
      productName: string;
      genericName: string | null;
      categoryName: string | null;
      unit: string;
      totalStock: number;
      reorderLevel: number;
      shortage: number;
    }[] = [];

    const expiringSoon: {
      productId: string;
      productName: string;
      genericName: string | null;
      categoryName: string | null;
      batchId: string;
      batchNumber: string;
      quantity: number;
      expiryDate: string;
      daysToExpiry: number;
    }[] = [];

    const expired: {
      productId: string;
      productName: string;
      genericName: string | null;
      categoryName: string | null;
      batchId: string;
      batchNumber: string;
      quantity: number;
      expiryDate: string;
      daysExpired: number;
    }[] = [];

    let totalInventoryValue = 0;
    let totalItems = 0;
    let itemsInStock = 0;

    for (const product of products) {
      const totalStock = product.batches.reduce((sum, b) => sum + b.quantity, 0);
      const inventoryValue = product.batches.reduce((sum, b) => sum + b.quantity * b.costPrice, 0);

      totalInventoryValue += inventoryValue;
      totalItems++;
      if (totalStock > 0) itemsInStock++;

      // Classify each batch
      for (const batch of product.batches) {
        const expiry = new Date(batch.expiryDate);
        const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (batch.quantity <= 0) continue;

        if (diffDays < 0) {
          expired.push({
            productId: product.id,
            productName: product.name,
            genericName: product.genericName,
            categoryName: product.category?.name ?? null,
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            quantity: batch.quantity,
            expiryDate: batch.expiryDate,
            daysExpired: Math.abs(diffDays),
          });
        } else if (diffDays < 90) {
          expiringSoon.push({
            productId: product.id,
            productName: product.name,
            genericName: product.genericName,
            categoryName: product.category?.name ?? null,
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            quantity: batch.quantity,
            expiryDate: batch.expiryDate,
            daysToExpiry: diffDays,
          });
        }
      }

      // Out of stock
      if (totalStock === 0) {
        outOfStock.push({
          productId: product.id,
          productName: product.name,
          genericName: product.genericName,
          categoryName: product.category?.name ?? null,
          unit: product.unit,
          reorderLevel: product.reorderLevel,
          totalStock: 0,
        });
      } else if (totalStock > 0 && totalStock <= product.reorderLevel) {
        lowStock.push({
          productId: product.id,
          productName: product.name,
          genericName: product.genericName,
          categoryName: product.category?.name ?? null,
          unit: product.unit,
          totalStock,
          reorderLevel: product.reorderLevel,
          shortage: product.reorderLevel - totalStock,
        });
      }
    }

    return NextResponse.json({
      summary: {
        totalItems,
        itemsInStock,
        totalInventoryValue,
        outOfStockCount: outOfStock.length,
        lowStockCount: lowStock.length,
        expiringSoonCount: expiringSoon.length,
        expiredCount: expired.length,
        criticalAlerts: outOfStock.length + expired.length,
      },
      outOfStock,
      lowStock,
      expiringSoon: expiringSoon.sort((a, b) => a.daysToExpiry - b.daysToExpiry),
      expired: expired.sort((a, b) => b.daysExpired - a.daysExpired),
    });
  } catch (error) {
    console.error('Inventory alerts error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch inventory alerts' },
      { status: 500 }
    );
  }
}
