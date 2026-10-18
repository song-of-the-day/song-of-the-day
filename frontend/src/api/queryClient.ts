/**
 * The app's TanStack Query client defaults.
 */
import { QueryClient } from '@tanstack/react-query';

import { isApiError } from './errors';

const MAX_QUERY_RETRIES = 2;
const DEFAULT_STALE_TIME_MS = 30_000;

/**
 * Decides whether a failed query is retried: client errors (4xx) never are, other failures
 * (network, 5xx) up to twice.
 *
 * @param failureCount - Failures so far.
 * @param error - The latest failure.
 * @returns Whether to retry.
 */
export function shouldRetryQuery(failureCount: number, error: Error): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < MAX_QUERY_RETRIES;
}

/**
 * Creates the query client used by the app.
 *
 * @returns A client whose queries retry per {@link shouldRetryQuery} and whose mutations never
 *   retry.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetryQuery, staleTime: DEFAULT_STALE_TIME_MS },
      mutations: { retry: false },
    },
  });
}
