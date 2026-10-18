/**
 * Client-side checks for the auth forms. They mirror the API's rules to give
 * instant feedback; the API stays the authority and its field errors are shown too.
 */
import { fieldErrors } from '@/api/errors';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const DISPLAY_NAME_MAX_LENGTH = 50;
export const EMAIL_MAX_LENGTH = 320;
export const PASSWORD_HINT = `Use ${String(PASSWORD_MIN_LENGTH)}–${String(PASSWORD_MAX_LENGTH)} characters.`;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Counts code points, like the API's length limits (Python `len`), rather than UTF-16 units.
 * Splitting emoji sequences apart is intended here: only the count matters.
 */
function codePointLength(value: string): number {
  return Array.from(value).length;
}

/** Validation messages keyed by field name. */
export type FieldErrorMap<Field extends string> = Partial<Record<Field, string>>;

/**
 * Checks an email address (trimmed and counted by code point, as the API does).
 *
 * @param value - The input value.
 * @returns An error message, or `undefined` when valid.
 */
export function validateEmail(value: string): string | undefined {
  const email = value.trim();
  if (email === '') {
    return 'Enter your email address.';
  }
  if (codePointLength(email) > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    return 'Enter a valid email address.';
  }
  return undefined;
}

/**
 * Checks a new password against the policy: 8–128 characters (counted like the API, by code
 * point), not all whitespace, never trimmed.
 *
 * @param value - The input value.
 * @returns An error message, or `undefined` when valid.
 */
export function validateNewPassword(value: string): string | undefined {
  const length = codePointLength(value);
  if (length === 0) {
    return 'Enter a password.';
  }
  if (length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${String(PASSWORD_MIN_LENGTH)} characters.`;
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${String(PASSWORD_MAX_LENGTH)} characters.`;
  }
  if (value.trim() === '') {
    return "A password can't be only spaces.";
  }
  return undefined;
}

/**
 * Checks a display name (1–50 characters after trimming).
 *
 * @param value - The input value.
 * @returns An error message, or `undefined` when valid.
 */
export function validateDisplayName(value: string): string | undefined {
  const name = value.trim();
  if (name === '') {
    return 'Enter a display name.';
  }
  if (codePointLength(name) > DISPLAY_NAME_MAX_LENGTH) {
    return `Use at most ${String(DISPLAY_NAME_MAX_LENGTH)} characters.`;
  }
  return undefined;
}

/**
 * Drops fields without an error.
 *
 * @param errors - Messages (or `undefined`) per field.
 * @returns Only the fields that have a message.
 */
export function compactErrors<Field extends string>(
  errors: Record<Field, string | undefined>,
): FieldErrorMap<Field> {
  const result: FieldErrorMap<Field> = {};
  for (const field of Object.keys(errors) as Field[]) {
    const message = errors[field];
    if (message !== undefined) {
      result[field] = message;
    }
  }
  return result;
}

/**
 * Picks the API's `422` field errors for a form's fields.
 *
 * @param error - The failed mutation's error.
 * @param fields - The form's field names, matching the request body keys.
 * @returns Messages for those fields (empty for other errors).
 */
export function apiFieldErrors<Field extends string>(
  error: unknown,
  fields: readonly Field[],
): FieldErrorMap<Field> {
  const all = fieldErrors(error);
  const result: FieldErrorMap<Field> = {};
  for (const field of fields) {
    const message = all[field];
    if (message !== undefined) {
      result[field] = message;
    }
  }
  return result;
}

/**
 * Finds the first field with an error, in form order (to move focus there).
 *
 * @param errors - The current errors.
 * @param order - The fields in the order they appear.
 * @returns The first invalid field, or `undefined`.
 */
export function firstInvalidField<Field extends string>(
  errors: FieldErrorMap<Field>,
  order: readonly Field[],
): Field | undefined {
  return order.find((field) => errors[field] !== undefined);
}
