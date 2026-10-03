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

/**
 * The `[start, end)` range covering one LOCAL day, from its `YYYY-MM-DD` key.
 *
 * Every place that turns a stored date string back into a query window built the
 * boundaries by hand — `new Date(date + 'T00:00:00')` in three different routes.
 * That form is parsed as local time by every runtime, which is what makes it
 * correct, but it also means an unchecked string silently becomes `Invalid Date`
 * and a Prisma range of `{ gte: Invalid Date }` throws rather than reporting the
 * bad input. Validating here turns a malformed key into one clear failure.
 *
 * @throws Error when `dateKey` is not a real calendar date. This is a
 *   programming/data-integrity fault, not user input — routes validate user input
 *   before getting here.
 */
export function localDayRange(dateKey: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    throw new Error(`Invalid local day key: ${dateKey}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const start = new Date(year, month - 1, day);
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) {
    throw new Error(`Invalid local day key: ${dateKey}`);
  }

  // Exclusive upper bound at the next local midnight, which also keeps the range
  // correct across a daylight-saving transition, where the day is not 24h long.
  return { start, end: new Date(year, month - 1, day + 1) };
}

/** First instant of the local month `months` before the one containing `date`. */
export function startOfLocalMonthOffset(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() - months, 1);
}

/**
 * Shifts a `YYYY-MM-DD` key by whole days, with no timezone in the arithmetic.
 *
 * The obvious spelling — parse the key, `setDate(getDate() - 1)`, then
 * `toISOString()` — is a round trip through UTC that the date is supposed to be
 * independent of. It happens to come out right in Ghana, which is why it
 * survived: it is silently wrong anywhere local midnight is not UTC midnight,
 * because `toISOString()` reports the UTC calendar day, not the local one.
 *
 * Doing the arithmetic in UTC instead is the inverse mistake in the safe
 * direction. A `YYYY-MM-DD` key has no zone and no time of day, so there is
 * nothing for the viewer's offset to shift: `Date.UTC` is used purely as a
 * calendar, and only the UTC fields are read back. No instant is ever
 * interpreted, so no offset, and no daylight-saving transition where a local day
 * is 23 or 25 hours long, can move the result.
 *
 * Month and day boundaries roll over correctly because the arithmetic happens in
 * UTC, where every day is exactly 86 400 000 ms.
 *
 * @throws Error when `dateKey` is not a real calendar date, matching
 *   `localDayRange` — an unchecked string otherwise becomes `NaN-NaN-NaN` and
 *   quietly queries a range nothing can match.
 */
export function shiftDateKey(dateKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    throw new Error(`Invalid local day key: ${dateKey}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Reject impossible calendar dates (2026-02-30) before arithmetic hides the
  // error: Date.UTC would silently roll it into March.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(`Invalid local day key: ${dateKey}`);
  }

  const shifted = new Date(probe.getTime() + days * 24 * 60 * 60 * 1000);
  const shiftedMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const shiftedDay = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${shiftedMonth}-${shiftedDay}`;
}

/** The `YYYY-MM-DD` key for the calendar day before `dateKey`. */
export function previousDateKey(dateKey: string): string {
  return shiftDateKey(dateKey, -1);
}
