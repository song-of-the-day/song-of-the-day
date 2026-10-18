/**
 * Query hooks for public profiles (`/api/users/<username>/…`). The profile page reads through
 * them in owner and visitor mode alike, keyed by the normalized username.
 */
import { queryOptions, useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';

import { daysInRange } from '@/lib/dates';

import { queryKeys } from '../keys';
import type { EntriesPage, Entry, IsoDate } from '../types';
import { getProfileEntry, getPublicProfile, listProfileEntries } from '../users';

/** Page size of the board's infinite list. */
export const BOARD_PAGE_SIZE = 60;
const MAX_PAGE_SIZE = 366;

function selectBoardEntries(data: InfiniteData<EntriesPage, IsoDate | undefined>): Entry[] {
  return data.pages.flatMap((page) => page.entries);
}

function selectEntries(page: EntriesPage): Entry[] {
  return page.entries;
}

function selectFirstEntry(page: EntriesPage): Entry | null {
  return page.entries[0] ?? null;
}

function rangeQuery(username: string, start: IsoDate, end: IsoDate) {
  return queryOptions({
    queryKey: queryKeys.range(username, start, end),
    queryFn: ({ signal }) =>
      listProfileEntries(
        username,
        { start, end, limit: Math.min(MAX_PAGE_SIZE, Math.max(1, daysInRange(start, end))) },
        signal,
      ),
  });
}

function profileQuery(username: string) {
  return queryOptions({
    queryKey: queryKeys.profile(username),
    queryFn: ({ signal }) => getPublicProfile(username, signal),
  });
}

/**
 * Loads a profile's header and theme.
 *
 * @param username - The normalized username.
 * @returns The query; it fails with `404 not_found` when nobody has this username.
 */
export function usePublicProfile(username: string) {
  return useQuery(profileQuery(username));
}

/**
 * Loads a profile's board: every entry, newest first, 60 per page.
 *
 * @param username - The normalized username.
 * @returns The infinite query; `data` is the flattened entry list. Call `fetchNextPage` while
 *   `hasNextPage` to load older entries.
 */
export function useProfileBoardEntries(username: string) {
  return useInfiniteQuery<
    EntriesPage,
    Error,
    Entry[],
    ReturnType<typeof queryKeys.board>,
    IsoDate | undefined
  >({
    queryKey: queryKeys.board(username),
    queryFn: ({ pageParam, signal }) =>
      listProfileEntries(username, { before: pageParam, limit: BOARD_PAGE_SIZE }, signal),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.next_before ?? undefined,
    select: selectBoardEntries,
  });
}

/**
 * Loads a profile's entries in an inclusive date range (one calendar month, at most a year).
 *
 * @param username - The normalized username.
 * @param start - The first day, `yyyy-MM-dd`.
 * @param end - The last day, `yyyy-MM-dd`.
 * @returns The query; `data` lists the entries newest first.
 */
export function useProfileEntriesRange(username: string, start: IsoDate, end: IsoDate) {
  return useQuery({ ...rangeQuery(username, start, end), select: selectEntries });
}

/**
 * Loads a profile's entry for one day, sharing the `['users', username, 'entries', 'range',
 * day, day]` cache (the owner's toolbar uses it for today).
 *
 * @param username - The normalized username.
 * @param today - The local date, `yyyy-MM-dd` (see `useToday`).
 * @returns The query; `data` is the entry, or `null` when the day has none.
 */
export function useTodayEntry(username: string, today: IsoDate) {
  return useQuery({ ...rangeQuery(username, today, today), select: selectFirstEntry });
}

/**
 * Loads one of a profile's entries with its annotations.
 *
 * @param username - The normalized username.
 * @param id - The entry id.
 * @returns The query; it fails with `404 not_found` when the entry isn't this user's.
 */
export function useProfileEntry(username: string, id: number) {
  return useQuery({
    queryKey: queryKeys.entry(username, id),
    queryFn: ({ signal }) => getProfileEntry(username, id, signal),
  });
}
