import { describe, expect, it } from 'vitest';

import {
  ApiError,
  existingEntryId,
  fieldErrors,
  hasErrorCode,
  isApiError,
  requestId,
  retryAfterSeconds,
} from './errors';

const conflict = new ApiError({
  status: 409,
  code: 'entry_exists',
  message: 'Already logged.',
  details: { existing_entry_id: 42 },
});

describe('ApiError', () => {
  it('is an Error with status, code, fields and details', () => {
    const error = new ApiError({
      status: 422,
      code: 'validation_error',
      message: 'Bad.',
      fields: { a: 'b' },
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiError');
    expect(error.message).toBe('Bad.');
    expect(error.fields).toEqual({ a: 'b' });
    expect(error.details).toEqual({});
  });
});

describe('guards', () => {
  it('narrows ApiError and codes', () => {
    expect(isApiError(conflict)).toBe(true);
    expect(isApiError(new Error('x'))).toBe(false);
    expect(isApiError('entry_exists')).toBe(false);
    expect(hasErrorCode(conflict, 'entry_exists')).toBe(true);
    expect(hasErrorCode(conflict, 'not_found')).toBe(false);
    expect(hasErrorCode(null, 'not_found')).toBe(false);
  });

  it('reads the existing entry id of entry_exists only', () => {
    expect(existingEntryId(conflict)).toBe(42);
    expect(
      existingEntryId(new ApiError({ status: 409, code: 'entry_exists', message: 'x' })),
    ).toBeNull();
    expect(
      existingEntryId(
        new ApiError({
          status: 409,
          code: 'email_taken',
          message: 'x',
          details: { existing_entry_id: 1 },
        }),
      ),
    ).toBeNull();
    expect(existingEntryId(new Error('x'))).toBeNull();
  });

  it('reads field errors', () => {
    const invalid = new ApiError({
      status: 422,
      code: 'validation_error',
      message: 'x',
      fields: { title: 'Required.' },
    });

    expect(fieldErrors(invalid)).toEqual({ title: 'Required.' });
    expect(fieldErrors(new Error('x'))).toEqual({});
  });

  it('reads the retry delay of a rate-limited error', () => {
    const limited = new ApiError({
      status: 429,
      code: 'rate_limited',
      message: 'x',
      details: { retry_after_seconds: 30 },
    });

    expect(retryAfterSeconds(limited)).toBe(30);
    expect(
      retryAfterSeconds(new ApiError({ status: 429, code: 'rate_limited', message: 'x' })),
    ).toBe(null);
    expect(retryAfterSeconds(new Error('x'))).toBeNull();
  });

  it('reads the request id of an internal error', () => {
    const failed = new ApiError({
      status: 500,
      code: 'internal_error',
      message: 'x',
      details: { request_id: 'req-1' },
    });

    expect(requestId(failed)).toBe('req-1');
    expect(
      requestId(
        new ApiError({
          status: 500,
          code: 'internal_error',
          message: 'x',
          details: { request_id: '' },
        }),
      ),
    ).toBeNull();
    expect(requestId('boom')).toBeNull();
  });
});
