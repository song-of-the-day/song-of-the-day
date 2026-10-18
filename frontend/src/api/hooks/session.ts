/**
 * Cache transitions when the logged-in user changes.
 */
import type { Query, QueryClient } from '@tanstack/react-query';

import { queryKeys } from '../keys';
import type { User } from '../types';

function isUserScoped(query: Query): boolean {
  return query.queryKey[0] !== queryKeys.me()[0];
}

/**
 * Records a new session: drops every cached query of a previous user and sets `['me']`.
 *
 * @param queryClient - The app's query client.
 * @param user - The user who just logged in or signed up.
 */
export function startSession(queryClient: QueryClient, user: User): void {
  queryClient.removeQueries({ predicate: isUserScoped });
  queryClient.setQueryData(queryKeys.me(), user);
}

/**
 * Records the end of a session: sets `['me']` to `null` and drops every other cached query.
 *
 * @param queryClient - The app's query client.
 */
export function endSession(queryClient: QueryClient): void {
  queryClient.setQueryData(queryKeys.me(), null);
  queryClient.removeQueries({ predicate: isUserScoped });
}
