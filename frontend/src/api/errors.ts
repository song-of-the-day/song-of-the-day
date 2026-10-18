/**
 * The error type thrown by every API call, plus type guards for common cases.
 */

/** Error codes the API (or the client, for non-API failures) can produce. */
export type ApiErrorCode =
  | 'invalid_json'
  | 'invalid_token'
  | 'unauthorized'
  | 'invalid_credentials'
  | 'csrf_failed'
  | 'not_found'
  | 'method_not_allowed'
  | 'email_taken'
  | 'username_taken'
  | 'entry_exists'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'validation_error'
  | 'invalid_image'
  | 'annotation_limit_reached'
  | 'rate_limited'
  | 'internal_error'
  | 'service_unavailable'
  | 'network_error';

export interface ApiErrorInit {
  /** HTTP status, or 0 when no response arrived. */
  status: number;
  code: string;
  message: string;
  /** Field errors keyed by dotted request-body path (`validation_error` only). */
  fields?: Record<string, string>;
  /**
   * Other keys of the error body, e.g. `existing_entry_id` or `request_id`, plus
   * `retry_after_seconds` from a `Retry-After` header.
   */
  details?: Record<string, unknown>;
}

/** A failed API call. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly details: Readonly<Record<string, unknown>>;

  /**
   * @param init - The error's status, code, message, field errors and extra details.
   */
  constructor({ status, code, message, fields = {}, details = {} }: ApiErrorInit) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
  }
}

/**
 * Narrows an unknown error to {@link ApiError}.
 *
 * @param error - Anything caught or returned by a query or mutation.
 * @returns Whether `error` is an `ApiError`.
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Checks an error's code.
 *
 * @param error - Anything caught or returned by a query or mutation.
 * @param code - The expected code.
 * @returns Whether `error` is an `ApiError` with that code.
 */
export function hasErrorCode(error: unknown, code: ApiErrorCode): error is ApiError {
  return isApiError(error) && error.code === code;
}

/**
 * Reads the conflicting entry id from a `409 entry_exists` error.
 *
 * @param error - Anything caught or returned by a mutation.
 * @returns The existing entry's id, or `null` for any other error.
 */
export function existingEntryId(error: unknown): number | null {
  if (!hasErrorCode(error, 'entry_exists')) {
    return null;
  }
  const id = error.details.existing_entry_id;
  return typeof id === 'number' ? id : null;
}

/**
 * Reads the field errors of a `422 validation_error`.
 *
 * @param error - Anything caught or returned by a mutation.
 * @returns Messages keyed by dotted field path (empty for any other error).
 */
export function fieldErrors(error: unknown): Readonly<Record<string, string>> {
  return isApiError(error) ? error.fields : {};
}

/**
 * Reads how long to wait before retrying, from a `429 rate_limited` response's `Retry-After`.
 *
 * @param error - Anything caught or returned by a query or mutation.
 * @returns The delay in seconds, or `null` when unknown.
 */
export function retryAfterSeconds(error: unknown): number | null {
  if (!isApiError(error)) {
    return null;
  }
  const seconds = error.details.retry_after_seconds;
  return typeof seconds === 'number' ? seconds : null;
}

/**
 * Reads the server's request id from a `500 internal_error`, for support requests.
 *
 * @param error - Anything caught or returned by a query or mutation.
 * @returns The request id, or `null` when absent.
 */
export function requestId(error: unknown): string | null {
  if (!isApiError(error)) {
    return null;
  }
  const id = error.details.request_id;
  return typeof id === 'string' && id !== '' ? id : null;
}
