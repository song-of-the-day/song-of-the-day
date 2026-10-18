/**
 * User-facing copy for API failures that a form or screen shows as a whole (not per field).
 */
import { isApiError, requestId, retryAfterSeconds } from './errors';

export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';
export const NETWORK_ERROR_MESSAGE =
  "Can't reach song of the day. Check your connection and try again.";
export const SERVER_ERROR_MESSAGE = 'Something went wrong on our side. Please try again.';
export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Reload the page and try again.';

function plural(count: number, unit: string): string {
  return `${String(count)} ${unit}${count === 1 ? '' : 's'}`;
}

/**
 * Formats a wait as a short, rounded-up duration.
 *
 * @param seconds - The delay in seconds.
 * @returns E.g. "45 seconds", "1 minute", "15 minutes" or "2 hours".
 */
export function formatWait(seconds: number): string {
  if (seconds < 60) {
    return plural(Math.max(1, Math.ceil(seconds)), 'second');
  }
  if (seconds < 3600) {
    return plural(Math.ceil(seconds / 60), 'minute');
  }
  return plural(Math.ceil(seconds / 3600), 'hour');
}

/**
 * Builds the message for a `429 rate_limited` response.
 *
 * @param seconds - The `Retry-After` delay, or `null` when unknown.
 * @returns A sentence telling the user when to try again.
 */
export function rateLimitMessage(seconds: number | null): string {
  return seconds === null
    ? 'Too many attempts. Wait a few minutes and try again.'
    : `Too many attempts. Try again in ${formatWait(seconds)}.`;
}

/**
 * Describes a failed request in words a user can act on.
 *
 * Rate limits, network failures, server errors and expired CSRF sessions get app copy; other API
 * errors use the server's message, which is written for users.
 *
 * @param error - Anything caught or returned by a query or mutation.
 * @returns One or two sentences.
 */
export function describeApiError(error: unknown): string {
  if (!isApiError(error)) {
    return GENERIC_ERROR_MESSAGE;
  }
  switch (error.code) {
    case 'rate_limited':
      return rateLimitMessage(retryAfterSeconds(error));
    case 'network_error':
      return NETWORK_ERROR_MESSAGE;
    case 'csrf_failed':
      return SESSION_EXPIRED_MESSAGE;
    case 'internal_error':
    case 'service_unavailable': {
      const id = requestId(error);
      return id === null ? SERVER_ERROR_MESSAGE : `${SERVER_ERROR_MESSAGE} (Reference: ${id})`;
    }
    default:
      return error.message === '' ? GENERIC_ERROR_MESSAGE : error.message;
  }
}
