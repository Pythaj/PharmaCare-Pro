/**
 * Currency rounding — the single source of truth for how a money amount is
 * reduced to the two decimals the ledger stores.
 *
 * `Math.round(n * 100) / 100` was copy-pasted into the sale handler, the return
 * proration maths and the dashboard charts. Each copy was identical today, but
 * nothing tied them together: a rounding rule changed in one place and the
 * register, the refund and the chart would each report a different total for the
 * same day.
 */

const CENTS_PER_UNIT = 100;

/**
 * Rounds to 2 decimal places, the precision every money column uses.
 *
 * A non-finite input returns 0 rather than propagating `NaN` or `Infinity` into
 * a sum: one bad row must not blank a reconciliation screen with `GHS NaN`.
 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * CENTS_PER_UNIT) / CENTS_PER_UNIT;
}

/** Sums a series of amounts and rounds the result once, at the end. */
export function sumMoney(values: readonly number[]): number {
  return roundMoney(values.reduce((total, value) => total + value, 0));
}