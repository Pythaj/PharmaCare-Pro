/**
 * Local-calendar date helpers — single source of truth (Rule 18).
 *
 * The app's reporting day is the pharmacy's LOCAL day: "today's sales" means
 * since local midnight, not since 00:00 UTC. Bucketing a timestamp with
 * `toISOString().slice(0, 10)` does exactly that wrong — in any timezone
 * behind UTC it files a late-evening sale under tomorrow, and a chart built
 * from those keys silently drops or double-counts a day. Every place that
 * groups rows by day must use these helpers instead.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight at the start of the given day. */
export function startOfLocalDay(date: Date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Exclusive end of the local day containing `date`. */
export function endOfLocalDay(date: Date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

/** `YYYY-MM-DD` in LOCAL time — the key used for day buckets and day records. */
export function localDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * `YYYY-MM` in LOCAL time — the key used for month buckets.
 *
 * The month is 1-based and zero-padded. The previous version used a raw
 * `getMonth()`, which is 0-indexed, so January produced `2026-0` and October
 * produced `2026-10`. Both are wrong in the same way: `2026-10` sorts BEFORE
 * `2026-2` as a string, so any caller that ordered months by key got a
 * scrambled year. Nothing in the app was affected yet because the only caller
 * (`dashboard/charts`) iterates the range explicitly rather than sorting by
 * key — which is exactly the sort of thing that breaks silently the day
 * someone adds a second caller. Keys must be sortable, or they are not keys.
 */
export function localMonthKey(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}`;
}

/** Local midnight `days` before the local day containing `date`. */
export function startOfLocalDayOffset(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - days);
}

/** First instant of the local month `months` before the one containing `date`. */
export function startOfLocalMonthOffset(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() - months, 1);
}
