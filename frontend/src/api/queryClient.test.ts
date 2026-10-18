import { describe, expect, it } from 'vitest';

import { ApiError } from './errors';
import { createQueryClient, shouldRetryQuery } from './queryClient';

function apiError(status: number): ApiError {
  return new ApiError({ status, code: 'x', message: 'x' });
}

describe('shouldRetryQuery', () => {
  it('never retries client errors', () => {
    for (const status of [400, 401, 404, 422, 429]) {
      expect(shouldRetryQuery(0, apiError(status))).toBe(false);
    }
  });

  it('retries server, network and unknown errors up to twice', () => {
    for (const error of [apiError(500), apiError(0), new Error('boom')]) {
      expect(shouldRetryQuery(0, error)).toBe(true);
      expect(shouldRetryQuery(1, error)).toBe(true);
      expect(shouldRetryQuery(2, error)).toBe(false);
    }
  });
});

describe('createQueryClient', () => {
  it('applies the app defaults', () => {
    const defaults = createQueryClient().getDefaultOptions();

    expect(defaults.queries?.retry).toBe(shouldRetryQuery);
    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.mutations?.retry).toBe(false);
  });
});
