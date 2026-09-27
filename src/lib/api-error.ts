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
