/**
 * Password policy — single source of truth (Rule 18), shared by the admin
 * account routes, the first-time setup route and the change-password route so
 * a password that one screen accepts can never be rejected by another.
 *
 * Dependency-free on purpose: the client imports MIN_PASSWORD_LENGTH for its
 * input hints without pulling bcrypt/jsonwebtoken into the browser bundle.
 */

export const MIN_PASSWORD_LENGTH = 8;

export const PASSWORD_RULE_MESSAGE = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;

/**
 * Validates a new password. Returns an error message, or null when acceptable.
 * `label` names the field in the message ("New password" vs "Password").
 */
export function validateNewPassword(
  value: unknown,
  label = 'Password'
): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return `${label} is required`;
  }
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `${label} must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}
