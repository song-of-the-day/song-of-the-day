/**
 * Username rules from `shared/usernames.json`, the single source of truth shared with the API.
 * Usernames name profile URLs (`/<username>`), so the reserved list covers every top-level route.
 * The error sentences live in the file's `messages` too, so client and server say the same thing.
 */
import rawUsernameRules from '@shared/usernames.json';

interface UsernameMessages {
  length: string;
  pattern: string;
  reserved: string;
  taken: string;
}

interface UsernameRules {
  minLength: number;
  maxLength: number;
  pattern: RegExp;
  reserved: ReadonlySet<string>;
  messages: UsernameMessages;
}

/**
 * Fills `{name}` placeholders the way the API does (`str.format`), leaving unknown ones alone.
 *
 * @param template - A message from `usernames.json`.
 * @param values - The placeholder values.
 * @returns The message with its placeholders replaced.
 */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/**
 * Checks the shape of the shared JSON once, so a malformed file fails loudly at load time.
 *
 * @param raw - The parsed `usernames.json`.
 * @returns The typed rules.
 * @throws Error when a field is missing or has the wrong type.
 */
export function parseUsernameRules(raw: unknown): UsernameRules {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('usernames.json: expected an object');
  }
  const { min_length, max_length, pattern, reserved, messages } = raw as Record<string, unknown>;
  if (
    typeof min_length !== 'number' ||
    typeof max_length !== 'number' ||
    typeof pattern !== 'string' ||
    !Array.isArray(reserved) ||
    !reserved.every((name) => typeof name === 'string') ||
    typeof messages !== 'object' ||
    messages === null ||
    !(['length', 'pattern', 'reserved', 'taken'] as const).every(
      (key) => typeof (messages as Record<string, unknown>)[key] === 'string',
    )
  ) {
    throw new Error('usernames.json: invalid rules');
  }
  return {
    minLength: min_length,
    maxLength: max_length,
    pattern: new RegExp(pattern),
    reserved: new Set(reserved),
    messages: messages as UsernameMessages,
  };
}

const RULES = parseUsernameRules(rawUsernameRules);

export const USERNAME_MIN_LENGTH = RULES.minLength;
export const USERNAME_MAX_LENGTH = RULES.maxLength;

/**
 * Normalizes a username the way the API does: trimmed and lower-cased.
 *
 * @param value - The raw input.
 * @returns The normalized username.
 */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Checks a username against the shared rules (after normalizing it), in the same order as the
 * API: length, pattern, reserved.
 *
 * @param value - The raw input.
 * @returns The first failing message from `usernames.json`, or `undefined` when valid.
 */
export function validateUsername(value: string): string | undefined {
  const username = normalizeUsername(value);
  if (username.length < RULES.minLength || username.length > RULES.maxLength) {
    return fill(RULES.messages.length, {
      min_length: RULES.minLength,
      max_length: RULES.maxLength,
    });
  }
  if (!RULES.pattern.test(username)) {
    return RULES.messages.pattern;
  }
  if (RULES.reserved.has(username)) {
    return fill(RULES.messages.reserved, { username });
  }
  return undefined;
}

/**
 * The `409 username_taken` sentence for a (normalized or raw) username.
 *
 * @param value - The username that is already in use.
 * @returns The message, identical to the API's `error.message`.
 */
export function usernameTakenMessage(value: string): string {
  return fill(RULES.messages.taken, { username: normalizeUsername(value) });
}

/**
 * Whether a URL segment can be a username at all (cheap check before asking the API).
 *
 * @param value - The raw input.
 * @returns `true` when {@link validateUsername} accepts it.
 */
export function isValidUsername(value: string): boolean {
  return validateUsername(value) === undefined;
}

/**
 * The public profile URL of a username on this site.
 *
 * @param username - A normalized username.
 * @param origin - The site origin (defaults to `location.origin`).
 * @returns The absolute URL.
 */
export function profileUrl(username: string, origin: string = window.location.origin): string {
  return `${origin}/${username}`;
}
