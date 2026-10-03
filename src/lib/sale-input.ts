/**
 * Sale request parsing — the single source of truth (Rule 18) for turning a cart
 * posted by the browser into the lines the sale handler writes.
 *
 * Pure and dependency-free: it never touches Prisma, so the arithmetic and
 * validation rules can be reasoned about — and tested — without a database.
 */

import { ValidationError } from '@/lib/api-error';

export const PAYMENT_METHODS = ['cash', 'card', 'mobile_money'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);
}

export function parsePaymentMethod(value: unknown): PaymentMethod {
  if (value === undefined || value === null || value === '') return 'cash';
  if (!isPaymentMethod(value)) {
    throw new ValidationError('Invalid payment method');
  }
  return value;
}

export interface SaleLineInput {
  productId: string;
  /** `null` means "let the server allocate from stock (FEFO)". */
  batchId: string | null;
  quantity: number;
}

/**
 * Shape-checks the posted cart and collapses lines that draw on the same stock.
 *
 * Collapsing is a correctness fix, not tidiness. The stock guard is per batch
 * (`quantity >= n`), so two cart lines naming one batch — which a client that
 * merges nothing can produce by sending the same batch twice, or by adding a
 * product in two steps when it has more than one batch — would each be validated
 * against the full on-hand quantity and each decrement separately. Two lines of 3
 * against a batch holding 5 both pass the check and leave the batch at -1.
 * Summing first makes the per-batch check mean what it says.
 *
 * Lines with no batch are keyed by product, because the FEFO allocation resolves
 * them against the same shelf.
 */
export function parseSaleLines(raw: unknown): SaleLineInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError('Items are required');
  }

  const merged = new Map<string, SaleLineInput>();

  raw.forEach((entry, index) => {
    const item = (entry ?? {}) as { productId?: unknown; batchId?: unknown; quantity?: unknown };

    if (typeof item.productId !== 'string' || !item.productId.trim()) {
      throw new ValidationError('Each item must have a productId');
    }
    const productId = item.productId.trim();

    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new ValidationError('Item quantities must be positive whole numbers');
    }

    const rawBatchId = item.batchId;
    let batchId: string | null = null;
    if (rawBatchId !== undefined && rawBatchId !== null && rawBatchId !== '') {
      if (typeof rawBatchId !== 'string') {
        throw new ValidationError(`Item ${index + 1}: batchId must be text`);
      }
      batchId = rawBatchId.trim();
      if (!batchId) batchId = null;
    }

    // A batch belongs to exactly one product, so the batch id alone identifies
    // the stock this line consumes.
    const key = batchId ?? `product:${productId}`;
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += quantity;
    } else {
      merged.set(key, { productId, batchId, quantity });
    }
  });

  return [...merged.values()];
}

/** Zero-pads a number to two digits, e.g. 7 -> "07". */
export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `YYYYMMDD` for an invoice-number prefix. */
export function compactDateKey(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

export interface ResolvedSaleDate {
  /** Instant the sale is recorded at (preserves the current time of day). */
  saleAt: Date;
  /** `YYYY-MM-DD` local day key. */
  dateKey: string;
  dayStart: Date;
  dayEnd: Date;
}

/**
 * Resolves the effective sale timestamp from an optional YYYY-MM-DD `saleDate`.
 *
 * Backdating is admin-only; the current time-of-day is preserved so intra-day
 * ordering stays meaningful. Returns the day boundaries as well, because the
 * invoice-number sequence and the day's register are both scoped to them.
 *
 * @throws ValidationError (400) on a malformed date, an impossible calendar date
 *   such as 2026-02-30, or a non-admin backdating.
 */
export function resolveSaleDate(saleDate: unknown, role: string, now: Date = new Date()): ResolvedSaleDate {
  if (!saleDate) {
    const ds = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    return {
      saleAt: now,
      dateKey: ds,
      dayStart: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      dayEnd: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
    };
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(saleDate));
  if (!m) {
    throw new ValidationError('saleDate must use the YYYY-MM-DD format');
  }
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  const dt = new Date(yyyy, mm - 1, dd);
  if (dt.getFullYear() !== yyyy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) {
    throw new ValidationError('Invalid saleDate');
  }

  const dateKey = `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
  const todayKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  if (dateKey !== todayKey && role !== 'admin') {
    throw new ValidationError('Only the admin can record a sale for a past date');
  }

  return {
    saleAt: dateKey === todayKey
      ? now
      : new Date(yyyy, mm - 1, dd, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds()),
    dateKey,
    dayStart: new Date(yyyy, mm - 1, dd),
    dayEnd: new Date(yyyy, mm - 1, dd + 1),
  };
}