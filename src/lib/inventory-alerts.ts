/**
 * Stock & expiry classification — single source of truth (Rule 18).
 *
 * Four endpoints used to answer "is this product low / is this batch expiring?"
 * with four slightly different implementations, which made the same pharmacy
 * show different alert counts on different screens. Every one of them now
 * derives its answer from the helpers below.
 *
 * Definitions (deliberately explicit):
 *  - out of stock  : total stock across in-stock batches is 0
 *  - low stock     : in stock, but at or below the product's reorder level
 *  - expired       : batch expiry date is in the past
 *  - expiring soon : expires within the configured warning window (not yet expired)
 */

/**
 * Fallback warning window, used only when a caller has no configured value.
 *
 * The real value is `notifications.expiryAlertDays`, read on the server by
 * `getExpiryAlertDays` and threaded in through the `warningDays` parameters
 * below. This constant is what those parameters default to, so it is a fallback
 * rather than the policy — anything that classifies expiry in a request handler
 * should pass the configured value in.
 */
export const EXPIRY_WARNING_DAYS = 90;
export const EXPIRY_CRITICAL_DAYS = 30;

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';
export type ExpiryStatus = 'good' | 'expiring_soon' | 'expired';

/** Whole days from `now` until `date`; negative once the date has passed. */
export function daysUntil(date: Date | string, now: Date = new Date()): number {
  const target = date instanceof Date ? date : new Date(date);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Stock status for a product. A reorder level of 0 means "never reorder", so
 * any positive stock counts as healthy and only a true zero is out of stock.
 */
export function classifyStock(totalStock: number, reorderLevel: number): StockStatus {
  if (totalStock <= 0) return 'out_of_stock';
  if (reorderLevel > 0 && totalStock <= reorderLevel) return 'low_stock';
  return 'in_stock';
}

export function isLowStock(totalStock: number, reorderLevel: number): boolean {
  return classifyStock(totalStock, reorderLevel) === 'low_stock';
}

export function isOutOfStock(totalStock: number): boolean {
  return totalStock <= 0;
}

/**
 * Expiry status of a single batch.
 *
 * `warningDays` defaults to `EXPIRY_WARNING_DAYS` so existing callers keep
 * their current behaviour, but the window is a parameter because it is the
 * owner's to configure: `notifications.expiryAlertDays` is the real answer, and
 * an endpoint that cannot pass it will keep warning at 90 days regardless of
 * what the Settings screen displays.
 */
export function classifyBatchExpiry(
  expiryDate: Date | string,
  now: Date = new Date(),
  warningDays: number = EXPIRY_WARNING_DAYS
): ExpiryStatus {
  const days = daysUntil(expiryDate, now);
  if (days < 0) return 'expired';
  if (days < warningDays) return 'expiring_soon';
  return 'good';
}

/** Combined product expiry status — expired wins over expiring. */
export function classifyProductExpiry(
  batchExpiries: (Date | string)[],
  now: Date = new Date(),
  warningDays: number = EXPIRY_WARNING_DAYS
): ExpiryStatus {
  let result: ExpiryStatus = 'good';
  for (const expiry of batchExpiries) {
    const status = classifyBatchExpiry(expiry, now, warningDays);
    if (status === 'expired') return 'expired';
    if (status === 'expiring_soon') result = 'expiring_soon';
  }
  return result;
}

export interface StockCounts {
  totalItems: number;
  itemsInStock: number;
  outOfStockCount: number;
  lowStockCount: number;
}

export interface ExpiryCounts {
  /** Batches already past their expiry date and still holding stock. */
  expiredCount: number;
  /** Batches expiring within EXPIRY_WARNING_DAYS and still holding stock. */
  expiringSoonCount: number;
}

/**
 * Counts products and batches from one pass over already-fetched data.
 * `batches` are expected to be the product's batches that still hold stock
 * (quantity > 0) — expired/depleted batches hold no stock and are not alerts.
 */
export function countStockAndExpiry(
  products: { reorderLevel: number; batches: { quantity: number; expiryDate: Date | string }[] }[],
  now: Date = new Date()
): StockCounts & ExpiryCounts {
  const counts: StockCounts & ExpiryCounts = {
    totalItems: 0,
    itemsInStock: 0,
    outOfStockCount: 0,
    lowStockCount: 0,
    expiredCount: 0,
    expiringSoonCount: 0,
  };

  for (const product of products) {
    counts.totalItems += 1;

    const totalStock = product.batches.reduce((sum, b) => sum + b.quantity, 0);
    const status = classifyStock(totalStock, product.reorderLevel);
    if (status === 'out_of_stock') counts.outOfStockCount += 1;
    else if (status === 'low_stock') counts.lowStockCount += 1;
    if (totalStock > 0) counts.itemsInStock += 1;

    for (const batch of product.batches) {
      if (batch.quantity <= 0) continue;
      const expiry = classifyBatchExpiry(batch.expiryDate, now);
      if (expiry === 'expired') counts.expiredCount += 1;
      else if (expiry === 'expiring_soon') counts.expiringSoonCount += 1;
    }
  }

  return counts;
}
