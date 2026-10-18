/**
 * The subset of the API's input validation that the fake API enforces:
 * strict unknown-field rejection, trimming, null handling, lengths, control characters and the
 * documented field rules.
 */

/** A JSON object request body. */
export type Body = Record<string, unknown>;

/** Collects `validation_error` field messages keyed by dotted path. */
export class FieldErrors {
  readonly errors: Record<string, string> = {};

  add(path: string, message: string): void {
    this.errors[path] ??= message;
  }

  get empty(): boolean {
    return Object.keys(this.errors).length === 0;
  }
}

// Control characters other than TAB/LF/CR (C0, DEL and C1), plus unpaired surrogates.
const FORBIDDEN_CHARACTERS =
  // eslint-disable-next-line no-control-regex -- matching control characters is the point.
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const LINE_BREAK = /[\r\n]/;

export const MESSAGES = {
  required: 'This field is required.',
  notNull: 'Cannot be null.',
  string: 'Must be a string.',
  integer: 'Must be an integer.',
  boolean: 'Must be a boolean.',
  unknown: 'Unknown field.',
  characters: 'Contains characters that are not allowed.',
  lineBreak: 'Must be a single line.',
} as const;

/**
 * Rejects keys outside `allowed`.
 */
export function rejectUnknown(
  body: Body,
  allowed: readonly string[],
  errors: FieldErrors,
  prefix = '',
): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      errors.add(`${prefix}${key}`, MESSAGES.unknown);
    }
  }
}

export interface StringRule {
  required?: boolean;
  nullable?: boolean;
  min?: number;
  max: number;
  multiline?: boolean;
  trim?: boolean;
}

/**
 * Reads a string field.
 *
 * @returns `undefined` when absent (or invalid), `null` for null or an empty optional string,
 *   otherwise the (trimmed) value.
 */
export function readString(
  body: Body,
  key: string,
  rule: StringRule,
  errors: FieldErrors,
): string | null | undefined {
  if (!(key in body)) {
    if (rule.required) {
      errors.add(key, MESSAGES.required);
    }
    return undefined;
  }
  const raw = body[key];
  if (raw === null) {
    if (!rule.nullable) {
      errors.add(key, MESSAGES.notNull);
    }
    return null;
  }
  if (typeof raw !== 'string') {
    errors.add(key, MESSAGES.string);
    return undefined;
  }
  if (FORBIDDEN_CHARACTERS.test(raw)) {
    errors.add(key, MESSAGES.characters);
    return undefined;
  }
  if (!rule.multiline && LINE_BREAK.test(raw)) {
    errors.add(key, MESSAGES.lineBreak);
    return undefined;
  }
  const value = rule.trim === false ? raw : raw.trim();
  if (value === '' && rule.nullable) {
    return null;
  }
  const min = rule.min ?? 0;
  if (value.length < min || value.length > rule.max) {
    errors.add(
      key,
      min > 0
        ? `Must be ${String(min)} to ${String(rule.max)} characters.`
        : `Must be at most ${String(rule.max)} characters.`,
    );
    return undefined;
  }
  return value;
}

export interface IntegerRule {
  required?: boolean;
  nullable?: boolean;
  min: number;
  max: number;
}

/**
 * Reads an integer field with the same absent/null conventions as {@link readString}.
 */
export function readInteger(
  body: Body,
  key: string,
  rule: IntegerRule,
  errors: FieldErrors,
): number | null | undefined {
  if (!(key in body)) {
    if (rule.required) {
      errors.add(key, MESSAGES.required);
    }
    return undefined;
  }
  const raw = body[key];
  if (raw === null) {
    if (!rule.nullable) {
      errors.add(key, MESSAGES.notNull);
    }
    return null;
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    errors.add(key, MESSAGES.integer);
    return undefined;
  }
  if (raw < rule.min || raw > rule.max) {
    errors.add(key, `Must be between ${String(rule.min)} and ${String(rule.max)}.`);
    return undefined;
  }
  return raw;
}

/**
 * Reads a field restricted to a set of string values.
 */
export function readEnum<K extends string>(
  body: Body,
  key: string,
  allowed: readonly K[],
  errors: FieldErrors,
  required = false,
): K | undefined {
  if (!(key in body)) {
    if (required) {
      errors.add(key, MESSAGES.required);
    }
    return undefined;
  }
  const raw = body[key];
  const keys: readonly unknown[] = allowed;
  if (raw === null) {
    errors.add(key, MESSAGES.notNull);
    return undefined;
  }
  if (!keys.includes(raw)) {
    errors.add(key, `Must be one of: ${allowed.join(', ')}.`);
    return undefined;
  }
  return allowed.find((candidate) => candidate === raw);
}

/**
 * Checks a URL: allowed schemes and, optionally, an allowlist of hosts (exact or subdomain).
 */
export function isAllowedUrl(
  value: string,
  protocols: readonly string[],
  hosts?: readonly string[],
): boolean {
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  if (!protocols.includes(url.protocol) || url.hostname === '') {
    return false;
  }
  return (
    hosts === undefined ||
    hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
  );
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Reads and normalizes an email (trimmed, lower-cased, ≤ 320 characters). */
export function readEmail(body: Body, errors: FieldErrors): string | undefined {
  const email = readString(body, 'email', { required: true, max: 320 }, errors);
  if (typeof email !== 'string') {
    return undefined;
  }
  if (!EMAIL.test(email)) {
    errors.add('email', 'Enter a valid email address.');
    return undefined;
  }
  return email.toLowerCase();
}

/** Reads a password field: 8–128 characters, not all whitespace, never trimmed. */
export function readPassword(body: Body, key: string, errors: FieldErrors): string | undefined {
  const password = readString(
    body,
    key,
    { required: true, min: 8, max: 128, multiline: true, trim: false },
    errors,
  );
  if (typeof password !== 'string') {
    return undefined;
  }
  if (password.trim() === '') {
    errors.add(key, 'Must not be all whitespace.');
    return undefined;
  }
  return password;
}

/** A JSON object (not an array). */
export function isBody(value: unknown): value is Body {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
