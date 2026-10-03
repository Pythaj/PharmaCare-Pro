/**
 * Shared API error handling.
 *
 * Routes used to hand-roll `class ValidationError extends Error {}` and a
 * blanket `catch -> 500`, which meant a bad field from the client surfaced as
 * an opaque "Something went wrong" instead of the actual message. A
 * `ValidationError` is a *client* mistake (HTTP 400); anything else is a real
 * server fault (HTTP 500) and must not leak internals to the browser.
 */

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Thrown when a request is well-formed but not permitted (HTTP 403). */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/** Thrown when a referenced record does not exist (HTTP 404). */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Thrown when a write would break a business invariant (HTTP 409). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * Whether a driver error is a unique-constraint violation.
 *
 * Checking a row and then inserting is check-then-act, so it loses to any
 * concurrent writer. When the constraint underneath is real (this schema has
 * `@@unique([productId, batchNumber, branchId])` on Batch, for one), the loser
 * of the race gets a raw driver error that the blanket catch turns into a 500 —
 * "Something went wrong" for what is actually "someone else took that number
 * first". Callers catch this specifically to retry or re-read.
 *
 * Deliberately matched by message as well as by code, because the two supported
 * backends disagree: Postgres through Prisma reports `P2002`, while the desktop
 * build's SQLite path can surface `SQLITE_CONSTRAINT_UNIQUE` /
 * `UNIQUE constraint failed` as a plain Error. Keying only on `P2002` would make
 * this silently return false for every desktop install, which is precisely where
 * the retry matters least and would hide the bug.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === 'P2002') return true;
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  return /unique constraint|UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(message);
}

/**
 * Builds the response for a record that a branch-scoped lookup did not find.
 *
 * A branch-owned row (a sale, a batch, a return) is looked up with its branch
 * in the `where` clause, which is the secure shape: the row is never loaded, so
 * no code path can accidentally act on another branch's data. The cost is that
 * "no such row" and "a row, but it belongs to another branch" collapse into the
 * same empty result — and the API contract distinguishes them, 403 against 404.
 * Collapsing them is a real regression: clients (and the isolation suite) branch
 * on the status to tell "you cannot touch this" from "it does not exist".
 *
 * `existsElsewhere` is an id-only probe, run only on the miss path, so it costs a
 * second query solely to produce the right status code and never returns the
 * foreign row's contents.
 *
 * @param notFoundMessage Body for the genuinely-absent case (404).
 * @param forbiddenMessage Body for the other-branch case (403).
 */
export function branchMissResponse(
  existsElsewhere: boolean,
  notFoundMessage: string,
  forbiddenMessage: string
): Response {
  return existsElsewhere
    ? Response.json({ error: forbiddenMessage }, { status: 403 })
    : Response.json({ error: notFoundMessage }, { status: 404 });
}

/**
 * Whether a record with this id exists at all, ignoring branch scope.
 *
 * Pass the id straight back into `branchMissResponse`. Intended for the miss
 * path only — it is an existence oracle, so calling it on a path that then
 * proceeds to read the row would undo the scoping it is paired with.
 */
export function idExists(
  counter: { count(args: { where: Record<string, unknown> }): Promise<number> },
  where: Record<string, unknown>
): Promise<boolean> {
  return counter.count({ where }).then((count) => count > 0);
}

/**
 * Maps a thrown error to a safe NextResponse, or returns null when the error is
 * not one of ours so the caller can log it and return a generic 500.
 *
 * @param fallbackMessage Message for genuinely unexpected server faults. Must
 *   not describe internal state.
 */
export function parseErrorResponse(
  error: unknown,
  fallbackMessage: string
): Response | null {
  if (error instanceof ValidationError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof ForbiddenError) {
    return Response.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof NotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof ConflictError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  return null;
}
