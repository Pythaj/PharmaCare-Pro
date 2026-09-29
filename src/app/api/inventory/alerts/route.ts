import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireBranchScope } from '@/lib/require-auth';
import { classifyBatchExpiry, classifyStock, daysUntil } from '@/lib/inventory-alerts';
import { getExpiryAlertDays } from '@/lib/server-settings';
import {
  createEffectiveValueResolver,
  loadBranchProductOverrides,
} from '@/lib/branch-product-settings';

/**
 * GET /api/inventory/alerts
 *
 * Classification comes from lib/inventory-alerts, the same helpers the product
 * list, dashboard stats and dashboard recent panels use — so a product can never
 * be "low stock" here and "in stock" there, and "expiring soon" always means
 * the same window that excludes already-expired stock. That window is the
 * owner's `notifications.expiryAlertDays`, and it is echoed back in the
 * response so the client labels the list with the number actually applied.
 */
export async function GET(request: NextRequest) {
  const auth = await requireBranchScope(request);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const now = new Date();

    // The "expiring soon" horizon is the owner's configured
    // `notifications.expiryAlertDays`, not the hardcoded 90 that
    // EXPIRY_WARNING_DAYS holds. The Settings screen already displayed the saved
    // value, so a shop that asked for 14-day warnings was shown "14" and
    // continued to get 90 with no way to tell the two apart.
    const expiryWarningDays = await getExpiryAlertDays();

    // The catalogue is shared across branches, but AVAILABILITY is not. Every
    // figure below — total stock, reorder shortfall, expiry warnings, inventory
    // value — is derived from this branch's batches only. Summing the whole
    // business's stock would make a shop with nothing on the shelf look
    // well-stocked because a different shop is full, which is precisely the
    // mistake that lets a customer be promised medicine that is not there.
    const branchId = auth.scope!.branchId;

    // The reorder threshold is per-branch. `Product.reorderLevel` is the
    // chain-wide default; a branch that orders a different volume overrides it
    // in BranchProductSetting. Comparing this branch's stock against the
    // chain-wide number was the cross-branch leak — it made one shop's reorder
    // policy move another's low-stock list.
    const resolveValues = createEffectiveValueResolver(await loadBranchProductOverrides(branchId));

    const products = await db.product.findMany({
      where: { active: true },
      include: {
        category: { select: { id: true, name: true } },
        batches: {
          where: branchId ? { branchId } : {},
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
      /** ISO-8601 — the wire format is always a string, never a Date object. */
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
      const inventoryValue = product.batches.reduce(
        (sum, b) => sum + b.quantity * Number(b.costPrice),
        0
      );

      totalInventoryValue += inventoryValue;
      totalItems++;
      if (totalStock > 0) itemsInStock++;

      // Classify each batch that still holds stock
      for (const batch of product.batches) {
        if (batch.quantity <= 0) continue;

        const status = classifyBatchExpiry(batch.expiryDate, now, expiryWarningDays);
        if (status === 'good') continue;

        const days = daysUntil(batch.expiryDate, now);
        const shared = {
          productId: product.id,
          productName: product.name,
          genericName: product.genericName,
          categoryName: product.category?.name ?? null,
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          quantity: batch.quantity,
          expiryDate: batch.expiryDate.toISOString(),
        };

        if (status === 'expired') {
          expired.push({ ...shared, daysExpired: Math.abs(days) });
        } else {
          expiringSoon.push({ ...shared, daysToExpiry: days });
        }
      }

      // Stock alerts come from the shared classifier, so a reorder level of 0
      // ("never reorder") can never flag a stocked product as low. The threshold
      // is this branch's, not the chain-wide default.
      const effective = resolveValues(product);
      const stockStatus = classifyStock(totalStock, effective.reorderLevel);

      if (stockStatus === 'out_of_stock') {
        outOfStock.push({
          productId: product.id,
          productName: product.name,
          genericName: product.genericName,
          categoryName: product.category?.name ?? null,
          unit: product.unit,
          reorderLevel: effective.reorderLevel,
          totalStock: 0,
        });
      } else if (stockStatus === 'low_stock') {
        lowStock.push({
          productId: product.id,
          productName: product.name,
          genericName: product.genericName,
          categoryName: product.category?.name ?? null,
          unit: product.unit,
          totalStock,
          reorderLevel: effective.reorderLevel,
          shortage: effective.reorderLevel - totalStock,
        });
      }
    }

    return NextResponse.json({
      // Echoed so the client can label the list with the window that actually
      // produced it. Without this the UI hardcodes a number to describe its own
      // contents, which is how "within 90 days" outlived the setting becoming
      // configurable.
      expiryWarningDays,
      summary: {
        totalItems,
        itemsInStock,
        totalInventoryValue,
        outOfStockCount: outOfStock.length,
        lowStockCount: lowStock.length,
        // Batches, not products: one product can hold several expiring batches.
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
