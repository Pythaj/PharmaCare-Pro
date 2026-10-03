/**
 * The daily reconciliation can be narrowed to one salesperson, but there is a
 * case a user id cannot express: a sale whose User row has since been deleted.
 *
 * `Sale.userId` is nullable, and the report groups those rows under "Unknown
 * salesperson". There is no id to select them by, so the UI asks for them with
 * this sentinel. The route translates it to `userId: null` — the actual column
 * value — and skips the user lookup.
 *
 * It is deliberately a value that can never be a cuid, so it cannot collide
 * with a real user. Before this existed the UI sent the literal `'unknown'` as
 * `userId`, the route tried to resolve it as a real user, found nothing, and
 * answered 404 "Salesperson not found" — so the one grouping the report has to
 * offer was the one grouping that could not be opened.
 */
export const UNKNOWN_SALESPERSON = 'unknown';

/** Whether a salesperson filter value is the deleted-user sentinel. */
export function isUnknownSalesperson(value: string | null | undefined): boolean {
  return value === UNKNOWN_SALESPERSON;
}
