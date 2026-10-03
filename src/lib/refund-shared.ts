import { toNumber } from '@/lib/utils';

/**
 * The refund ACCOUNTING CONTRACT — pure types and arithmetic, safe to import from
 * a client component.
 *
 * WHY THIS IS NOT IN `refunds.ts`
 *
 * `refunds.ts` holds the queries, and a query needs `@/lib/db`, which is
 * server-only. Importing `ZERO_REFUNDS` from there into a `'use client'` component
 * drags the Prisma client into the browser bundle. `tsc` will not catch it —
 * TypeScript has no idea which modules touch a database — so the split has to be
 * enforced by structure rather than by the compiler: pure money rules here, data
 * access there, `refunds.ts` re-exports both so server routes can keep importing
 * one module.
 *
 * WHAT BELONGS HERE
 *
 * Anything that decides what a number means. `refunds.ts` asks the database which
 * refunds were approved; this file decides what those refunds do to a day's
 * figures. Keeping the arithmetic out of the routes is what stops the register,
 * the dashboard and the reports from each rounding their own way.
 *
 * THE ACCOUNTING RULE, in one line: GROSS is what the tills collected, REFUNDS is
 * what left them, NET is what the business actually earned. Gross stays stored and
 * stays visible, because "we sold 400 and gave 50 back" is a true and useful
 * sentence; net is the headline, because it is the number worth optimising.
 */

/** Money that left the till on a given trading day, from refunds only. */
export interface RefundTotals {
  /** How many approved refunds were processed. */
  refundCount: number;
  totalRefunds: number;
  cashRefunds: number;
  cardRefunds: number;
  mobileMoneyRefunds: number;
}

export const ZERO_REFUNDS: RefundTotals = {
  refundCount: 0,
  totalRefunds: 0,
  cashRefunds: 0,
  cardRefunds: 0,
  mobileMoneyRefunds: 0,
};

/** The minimum a refund row must expose to be totalled against a till. */
export interface RefundForAggregation {
  totalRefund: unknown;
  /** The original sale's tender. A refund is paid back the way it was taken. */
  paymentMethod: string;
}

/**
 * Reduces a day's refunds to the money that left the till, bucketed by tender.
 *
 * THREE DECISIONS, each deliberate:
 *
 * 1. `status: 'approved'` only (enforced by the query, not here). A pending
 *    return is a request that may never be actioned and a rejected one never
 *    was; neither has moved money, so counting either would invent a shortfall
 *    that never happened.
 * 2. Attributed to `Return.createdAt`, the day the refund was PROCESSED, not the
 *    day of the sale being refunded. The drawer loses the cash on the day it goes
 *    out, so that is the day the count happens on. (Where a pending return is
 *    approved on a later day, the cash leaves on that later day while this counts
 *    it on the creation day. Returns are created approved by default, so this is
 *    the exception, not the rule; correcting it would mean recording an approval
 *    timestamp the schema does not currently keep.)
 * 3. Branch-scoped through the SALE. A return has no branch of its own — it
 *    inherits one from the sale it refunds — so the filter has to be a relation
 *    constraint or one shop's refunds land in another's till.
 */
export function aggregateRefunds(refunds: readonly RefundForAggregation[]): RefundTotals {
  const totals = refunds.map((refund) => ({
    totalRefund: toNumber(refund.totalRefund),
    paymentMethod: refund.paymentMethod,
  }));

  const byPayment = (method: string) =>
    totals
      .filter((refund) => refund.paymentMethod === method)
      .reduce((sum, refund) => sum + refund.totalRefund, 0);

  return {
    refundCount: totals.length,
    totalRefunds: totals.reduce((sum, refund) => sum + refund.totalRefund, 0),
    cashRefunds: byPayment('cash'),
    cardRefunds: byPayment('card'),
    mobileMoneyRefunds: byPayment('mobile_money'),
  };
}

/** Just the money and the count, from a window's approved refunds. */
export interface RefundMoney {
  totalRefunds: number;
  refundCount: number;
}

/** One product's share of refunds, summed across them. */
export interface ProductRefundTotals {
  quantity: number;
  refundAmount: number;
}

/**
 * The reporting pair every screen shows: what came in, what went back out, and
 * what is left.
 */
export interface RevenueSummary {
  grossRevenue: number;
  grossProfit: number;
  totalRefunds: number;
  /** grossRevenue - totalRefunds. The figure to headline. */
  netRevenue: number;
  refundedProfit: number;
  /** grossProfit - refundedProfit. */
  netProfit: number;
  refundCount: number;
  refunds: RefundTotals;
}

/** The gross/refund/net shape of a refund line, enough to reduce a total. */
export interface RefundForSummary {
  totalRefund: number;
  paymentMethod: string;
  refundedProfit: number;
}

/**
 * Combines gross figures with the refunds that reduce them.
 *
 * Rounding: refunds are currency and the three figures must reconcile by eye
 * (gross - refunds === net), so the net is computed from ROUNDED inputs rather
 * than rounded afterwards. Rounding 12.005 - 0.005 could otherwise print a penny
 * that does not add up, and a till report that does not add up is worse than one
 * that is a hair conservative.
 */
export function summarizeRevenue(
  gross: { revenue: number; profit: number },
  refunds: readonly RefundForSummary[],
  totals?: RefundTotals
): RevenueSummary {
  const grossRevenue = round2(gross.revenue);
  const grossProfit = round2(gross.profit);
  const refundedProfit = round2(
    refunds.reduce((sum, refund) => sum + refund.refundedProfit, 0)
  );
  const refundTotals = totals ?? aggregateRefunds(refunds);
  const totalRefunds = round2(refundTotals.totalRefunds);

  return {
    grossRevenue,
    grossProfit,
    totalRefunds,
    netRevenue: round2(grossRevenue - totalRefunds),
    refundedProfit,
    netProfit: round2(grossProfit - refundedProfit),
    refundCount: refundTotals.refundCount,
    refunds: { ...refundTotals, totalRefunds },
  };
}

/** The empty summary, for a window with no sales and no refunds. */
export function zeroRevenueSummary(): RevenueSummary {
  return summarizeRevenue({ revenue: 0, profit: 0 }, []);
}

/** Currency rounds at the penny, everywhere in this module. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}