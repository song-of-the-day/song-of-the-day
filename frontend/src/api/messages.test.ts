import { describe, expect, it } from 'vitest';

import { ApiError } from './errors';
import {
  describeApiError,
  formatWait,
  GENERIC_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  rateLimitMessage,
  SERVER_ERROR_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
} from './messages';

function apiError(code: string, message = 'Server says no.', details = {}): ApiError {
  return new ApiError({ status: 400, code, message, details });
}

describe('formatWait', () => {
  it.each([
    [0, '1 second'],
    [1, '1 second'],
    [45, '45 seconds'],
    [59.2, '60 seconds'],
    [60, '1 minute'],
    [61, '2 minutes'],
    [900, '15 minutes'],
    [3600, '1 hour'],
    [3601, '2 hours'],
  ])('formats %s seconds as "%s"', (seconds, expected) => {
    expect(formatWait(seconds)).toBe(expected);
  });
});

describe('rateLimitMessage', () => {
  it('names the wait when it is known', () => {
    expect(rateLimitMessage(120)).toBe('Too many attempts. Try again in 2 minutes.');
  });

  it('falls back to a vague wait', () => {
    expect(rateLimitMessage(null)).toBe('Too many attempts. Wait a few minutes and try again.');
  });
});

describe('describeApiError', () => {
  it('uses app copy for rate limits, network failures and expired sessions', () => {
    expect(describeApiError(apiError('rate_limited', 'x', { retry_after_seconds: 30 }))).toBe(
      'Too many attempts. Try again in 30 seconds.',
    );
    expect(describeApiError(apiError('network_error'))).toBe(NETWORK_ERROR_MESSAGE);
    expect(describeApiError(apiError('csrf_failed'))).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it('adds the request id to server errors when present', () => {
    expect(describeApiError(apiError('internal_error', 'x', { request_id: 'abc123' }))).toBe(
      `${SERVER_ERROR_MESSAGE} (Reference: abc123)`,
    );
    expect(describeApiError(apiError('service_unavailable'))).toBe(SERVER_ERROR_MESSAGE);
  });

  it("uses the server's message for other API errors", () => {
    expect(describeApiError(apiError('not_found', 'Entry not found.'))).toBe('Entry not found.');
  });

  it('falls back to a generic message', () => {
    expect(describeApiError(apiError('not_found', ''))).toBe(GENERIC_ERROR_MESSAGE);
    expect(describeApiError(new Error('boom'))).toBe(GENERIC_ERROR_MESSAGE);
  });
});
