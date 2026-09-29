/**
 * Branch data reset — "start this shop afresh" without losing the drug
 * catalogue (Rule 18).
 *
 * WHY THIS IS NOT A DELETE-EVERYTHING BUTTON
 *
 * A `Product` is GLOBAL: one row, shared by every till, and the thing the
 * whole business is built on. A `Batch` is BRANCH-OWNED stock. Owners who
 * start a new accounting period, or who install this app on a branch that
 * already had a stock count typed in by hand, do not want the drug list wiped
 * — they want the *quantities* back to zero so they can walk the shelves and
 * type in what is really there. Deleting the products would destroy the
 * catalogue, the price history, and every other branch's ability to sell.
 *
 * So the reset is expressed as a set of explicit, opt-in SCOPES, each of
 * which is a no-op unless the admin ticks it:
 *
 *  - `stock`     zero every batch quantity at the branch. THE DEFAULT ASK.
 *               Batches, prices, expiries and product rows are all kept.
 *  - `sales`     delete this branch's sales. Sale items and returns cascade.
 *  - `registers` delete this branch's open/closed day summaries.
 *  - `purchases` delete this branch's purchase records.
 *
 * WHAT IT NEVER TOUCHES
 *
 * Products, categories, suppliers, customers, users, branches, the drug
 * catalogue, batch rows, batch prices, batch numbers and expiry dates. There
 * is no scope that can delete a drug, and no code path here can reach a
 * `Product` row at all — the write set is `batch`, `sale`, `dailySalesRecord`
 * and `purchase`, and nothing else.
 *
 * THE STOCK/ORDERING RULE THAT MATTERS
 *
 * Zeroing stock and deleting sales are independent, and clearing only one of
 * them leaves the branch in a state that looks like a bug:
 *
 *  - `stock` alone: quantities read 0, but yesterday's takings are still in
 *    the reports. That is the normal "new period, same history" position.
 *  - `sales` alone: the till is empty, but the shelves still show the units
 *    that were already sold. The POS will happily sell them again.
 *
 * Because the two interact, the UI shows the resulting stock-to-revenue
 * position for each choice rather than leaving the admin to discover it.
 *
 * SAFETY
 *
 *  - Branch-scoped and required: there is no "all branches" reset. One admin
 *    click can never clear the whole business.
 *  - Every scope is counted before anything is written, and the counts are
 *    returned to the caller so the UI can show exactly what was affected.
 *  - All selected scopes commit in ONE transaction: a reset that half-applied
 *    (stock zeroed, sales kept) is worse than one that refused.
 *  - The caller writes the audit row INSIDE that same transaction, so the
 *    record of the reset cannot be lost by a rollback.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

/** The clearable datasets, in the order they are presented. */
export const RESET_SCOPES = ['stock', 'sales', 'registers', 'purchases'] as const;
export type ResetScope = (typeof RESET_SCOPES)[number];

const SCOPE_SET: ReadonlySet<string> = new Set(RESET_SCOPES);

export function isResetScope(value: unknown): value is ResetScope {
  return typeof value === 'string' && SCOPE_SET.has(value);
}

/**
 * Filters an untrusted list down to known scopes, de-duplicated.
 * Unknown entries are dropped rather than rejected: a future client sending a
 * scope this server does not know about should degrade to the scopes it does,
 * not fail the whole reset.
 */
export function parseResetScopes(value: unknown): ResetScope[] {
  if (!Array.isArray(value)) return [];
  const out: ResetScope[] = [];
  for (const entry of value) {
    if (isResetScope(entry) && !out.includes(entry)) out.push(entry);
  }
  // Preserve RESET_SCOPES order so the reported counts and the deletion order
  // are stable regardless of how the client sorted them.
  return RESET_SCOPES.filter((s) => out.includes(s));
}

/** Row counts a scope would affect, plus the units involved for `stock`. */
export interface ResetImpact {
  stock: { batches: number; units: number };
  sales: { sales: number; items: number; returns: number };
  registers: { records: number };
  purchases: { purchases: number };
}

export const EMPTY_IMPACT: ResetImpact = {
  stock: { batches: 0, units: 0 },
  sales: { sales: 0, items: 0, returns: 0 },
  registers: { records: 0 },
  purchases: { purchases: 0 },
};

/**
 * Counts everything the given scopes WOULD change, without changing anything.
 * This is what the confirmation dialog renders, so the admin approves a
 * specific number rather than an abstract "delete data".
 *
 * Read-only: it issues `count`/`aggregate` only.
 */
export async function measureResetImpact(
  tx: Prisma.TransactionClient | PrismaClient,
  branchId: string,
  scopes: readonly ResetScope[]
): Promise<ResetImpact> {
  const impact: ResetImpact = {
    stock: { batches: 0, units: 0 },
    sales: { sales: 0, items: 0, returns: 0 },
    registers: { records: 0 },
    purchases: { purchases: 0 },
  };

  if (scopes.includes('stock')) {
    const [batches, units] = await Promise.all([
      tx.batch.count({ where: { branchId } }),
      // Only units actually on the shelf. A branch with 400 catalogue batches
      // sitting at 0 should read "0 units", not "400", or the number stops
      // meaning anything.
      tx.batch.aggregate({ where: { branchId }, _sum: { quantity: true } }),
    ]);
    impact.stock = { batches, units: units._sum.quantity ?? 0 };
  }

  if (scopes.includes('sales')) {
    const [sales, items, returns] = await Promise.all([
      tx.sale.count({ where: { branchId } }),
      // Counted through the join rather than by first listing sale ids, so this
      // is a single query and stays correct as the dataset grows.
      tx.saleItem.count({ where: { sale: { branchId } } }),
      tx.return.count({ where: { sale: { branchId } } }),
    ]);
    impact.sales = { sales, items, returns };
  }

  if (scopes.includes('registers')) {
    impact.registers = {
      records: await tx.dailySalesRecord.count({ where: { branchId } }),
    };
  }

  if (scopes.includes('purchases')) {
    impact.purchases = {
      purchases: await tx.purchase.count({ where: { branchId } }),
    };
  }

  return impact;
}

// `measureResetImpact` only ever calls count/aggregate, both of which exist on
// the full client and the interactive-transaction client alike.

/** Human summary of what a reset did, written into the audit trail. */
export function describeReset(
  branchName: string,
  scopes: readonly ResetScope[],
  impact: ResetImpact
): string {
  const parts: string[] = [];
  if (scopes.includes('stock')) {
    parts.push(`zeroed ${impact.stock.units} unit(s) across ${impact.stock.batches} batch(es)`);
  }
  if (scopes.includes('sales')) {
    parts.push(
      `deleted ${impact.sales.sales} sale(s) with ${impact.sales.items} line(s) and ${impact.sales.returns} return(s)`
    );
  }
  if (scopes.includes('registers')) {
    parts.push(`deleted ${impact.registers.records} day register(s)`);
  }
  if (scopes.includes('purchases')) {
    parts.push(`deleted ${impact.purchases.purchases} purchase record(s)`);
  }
  if (parts.length === 0) return `Reset requested for ${branchName} with no scopes selected; nothing changed`;
  return `Reset ${branchName}: ${parts.join('; ')}. Drug catalogue and batch records kept.`;
}
