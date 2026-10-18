/**
 * Public profile endpoints (`/api/users/<username>/…`): read-only,
 * no session needed. The profile page reads through them in owner and visitor mode alike.
 */
import { apiJson } from './client';
import type { EntriesPage, EntriesQuery, EntryDetail, PublicProfile } from './types';

function userPath(username: string): string {
  return `/users/${encodeURIComponent(username)}`;
}

/**
 * Loads a profile's header and theme (`GET /api/users/<username>`).
 *
 * @param username - The username (looked up case-insensitively).
 * @param signal - Aborts the request.
 * @returns The public profile.
 * @throws ApiError `404 not_found` when nobody has this username.
 */
export async function getPublicProfile(
  username: string,
  signal?: AbortSignal,
): Promise<PublicProfile> {
  const body = await apiJson(userPath(username), { signal });
  return (body as { profile: PublicProfile }).profile;
}

/**
 * Lists a profile's entries newest first (`GET /api/users/<username>/entries`), with the same
 * filters and cursor as the owner's `GET /api/entries`.
 *
 * @param username - The username.
 * @param query - Date bounds, cursor and page size.
 * @param signal - Aborts the request.
 * @returns One page and the cursor for the next.
 */
export async function listProfileEntries(
  username: string,
  query: EntriesQuery,
  signal?: AbortSignal,
): Promise<EntriesPage> {
  const body = await apiJson(`${userPath(username)}/entries`, { query: { ...query }, signal });
  return body as EntriesPage;
}

/**
 * Loads one of a profile's entries with its annotations
 * (`GET /api/users/<username>/entries/<id>`).
 *
 * @param username - The username.
 * @param id - The entry id.
 * @param signal - Aborts the request.
 * @returns The entry.
 * @throws ApiError `404 not_found` when the entry doesn't exist or isn't this user's.
 */
export async function getProfileEntry(
  username: string,
  id: number,
  signal?: AbortSignal,
): Promise<EntryDetail> {
  const body = await apiJson(`${userPath(username)}/entries/${String(id)}`, { signal });
  return (body as { entry: EntryDetail }).entry;
}
