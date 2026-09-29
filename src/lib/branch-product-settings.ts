/**
 * Per-branch product overrides — the read path for `BranchProductSetting`.
 *
 * ## The problem this solves
 *
 * The catalogue is shared on purpose: one `Product` row describes Panadol for
 * every branch, and duplicating it per shop would create the very drift the
 * owner is worried about (four copies of a product, four names, four prices,
 * none of them matching).
 *
 * But two fields on that shared row are *not* the same in every shop:
 *
 *  - `reorderLevel`. A flagship branch ordering 200 units and a village branch
 *    ordering 20 cannot both be served by one number. The threshold was global
 *    while the stock it is compared against is branch-scoped, so setting it at
 *    Branch A silently moved Branch B's "low stock" list and reorder shortfall
 *    with it. The branch that owns the fix could not see it, because the UI
 *    showed them the chain-wide number as if it were theirs.
 *  - The default price for *newly received* batches. `Batch.sellingPrice` is
 *    already per-branch and is what the till actually charges, so a branch that
 *    prices a product differently still had to retype that price on every single
 *    delivery — one forgotten field and the branch was stocked at 0.
 *
 * ## The two rules that keep this honest
 *
 * 1. **NULL means inherit, 0 means zero.** A NULL `reorderLevel` defers to
 *    `Product.reorderLevel`; an explicit `0` means "never flag this as low at
 *    this branch". Collapsing the two would make it impossible to turn an alert
 *    off locally, which is a legitimate thing to want.
 * 2. **A consolidated view uses the chain-wide value.** With no branch selected
 *    there is no single correct threshold — every branch may have its own — so
 *    these helpers deliberately fall back to `Product.reorderLevel` rather than
 *    picking an arbitrary branch. The answer is the chain-wide default, and
 *    callers label it as such instead of implying per-branch precision they do
 *    not have.
 *
 * Price overrides are read here too, but note their narrow meaning: they supply
 * the starting value when a batch is received without an explicit price. They
 * never reprice stock that is already on a shelf.
 */

import { db } from '@/lib/db';

/** The three fields a branch may override. Matches the column set on the model. */
export type OverridableField = 'reorderLevel' | 'sellingPrice' | 'costPrice';

/**
 * Prisma's `Decimal` is a class, not a number or a string, so it cannot be typed
 * as either without every call site casting. Structurally it is "anything that
 * stringifies to a number", which is exactly what the coercion below needs.
 */
type NumericLike = number | string | { toString(): string };

/**
 * Minimal shape needed to resolve effective values. Matches `Product`.
 *
 * The price fields are optional because not every caller needs them: the
 * dashboard tiles fetch only `id` and `reorderLevel`, and forcing them to select
 * columns they never read would put the price fetch back in for no reason.
 */
export interface ProductDefaults {
  id: string;
  reorderLevel: number;
  defaultSellingPrice?: NumericLike | null;
  defaultCostPrice?: NumericLike | null;
}

/** A `BranchProductSetting` row, or anything shaped like one. */
export interface BranchProductOverride {
  reorderLevel: number | null;
  sellingPrice: number | null;
  costPrice: number | null;
}

export interface EffectiveProductValues {
  /** The threshold this branch actually compares stock against. */
  reorderLevel: number;
  /** Default selling price for a batch received here without an explicit price. */
  sellingPrice: number;
  /** Default cost price for a batch received here without an explicit price. */
  costPrice: number;
  /** True when at least one value came from a branch override. */
  isOverridden: boolean;
  /** Which fields were overridden — so the UI can badge them, not just guess. */
  overriddenFields: OverridableField[];
}

/** Decimal columns arrive as `Decimal`; coerce defensively, never returning NaN. */
function toFiniteNumber(value: NumericLike | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Effective values for one product at one branch.
 *
 * Pure and synchronous: given the same defaults and override it always returns
 * the same answer, so a caller can resolve a whole page of products without
 * touching the database once the override map is loaded.
 */
export function resolveEffectiveValues(
  product: ProductDefaults,
  override?: BranchProductOverride | null
): EffectiveProductValues {
  const base: EffectiveProductValues = {
    reorderLevel: toFiniteNumber(product.reorderLevel, 0),
    sellingPrice: toFiniteNumber(product.defaultSellingPrice, 0),
    costPrice: toFiniteNumber(product.defaultCostPrice, 0),
    isOverridden: false,
    overriddenFields: [],
  };

  if (!override) return base;

  // Each field is resolved independently: an override that sets only a reorder
  // level must not drag the branch onto a different default price as a side
  // effect, which is what a "replace the whole object" approach would do.
  if (override.reorderLevel !== null && override.reorderLevel !== undefined) {
    base.reorderLevel = toFiniteNumber(override.reorderLevel, base.reorderLevel);
    base.overriddenFields.push('reorderLevel');
  }
  if (override.sellingPrice !== null && override.sellingPrice !== undefined) {
    base.sellingPrice = toFiniteNumber(override.sellingPrice, base.sellingPrice);
    base.overriddenFields.push('sellingPrice');
  }
  if (override.costPrice !== null && override.costPrice !== undefined) {
    base.costPrice = toFiniteNumber(override.costPrice, base.costPrice);
    base.overriddenFields.push('costPrice');
  }

  base.isOverridden = base.overriddenFields.length > 0;
  return base;
}

/**
 * Loads this branch's overrides, keyed by product id.
 *
 * A null `branchId` is the consolidated "All branches" view, and it returns an
 * empty map so every product resolves to its chain-wide value — see rule 2 in
 * the file header for why that is the honest answer rather than a limitation.
 */
export async function loadBranchProductOverrides(
  branchId: string | null
): Promise<Map<string, BranchProductOverride>> {
  const map = new Map<string, BranchProductOverride>();
  if (!branchId) return map;

  const rows = await db.branchProductSetting.findMany({
    where: { branchId },
    select: { productId: true, reorderLevel: true, sellingPrice: true, costPrice: true },
  });

  for (const row of rows) {
    map.set(row.productId, {
      reorderLevel: row.reorderLevel,
      sellingPrice: row.sellingPrice,
      costPrice: row.costPrice,
    });
  }

  return map;
}

/**
 * A bound resolver, so hot loops read as `resolve(product).reorderLevel` instead
 * of every call site repeating the `overrides.get(id)` dance.
 */
export function createEffectiveValueResolver(
  overrides: Map<string, BranchProductOverride>
): (product: ProductDefaults) => EffectiveProductValues {
  return (product) => resolveEffectiveValues(product, overrides.get(product.id));
}
