/**
 * Cache helpers for the owner's mutations: the owner's profile data is cached under
 * `['users', me.username, …]`, the same keys the public profile page reads.
 */
import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '../keys';
import type { PublicProfile, User } from '../types';

/**
 * Reads the logged-in user's username from `['me']`.
 *
 * @param queryClient - The app's query client.
 * @returns The username, or `null` when nobody is logged in.
 */
export function ownerUsername(queryClient: QueryClient): string | null {
  return queryClient.getQueryData<User | null>(queryKeys.me())?.username ?? null;
}

/**
 * The key prefix of the owner's entry lists, or of every profile when the owner is unknown (so a
 * mutation never leaves a stale list behind).
 *
 * @param queryClient - The app's query client.
 * @returns The prefix to invalidate.
 */
export function ownerEntriesKey(queryClient: QueryClient): readonly unknown[] {
  const username = ownerUsername(queryClient);
  return username === null ? queryKeys.users() : queryKeys.entries(username);
}

/**
 * The public view of the logged-in user, as `GET /api/users/<username>` returns it.
 *
 * @param user - The user.
 * @returns Its public profile.
 */
export function publicProfileOf(user: User): PublicProfile {
  return {
    username: user.username,
    display_name: user.display_name,
    bio: user.bio,
    theme: user.theme,
    created_at: user.created_at,
  };
}
