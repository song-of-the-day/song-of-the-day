/**
 * Query hook for iTunes song search.
 */
import { useQuery } from '@tanstack/react-query';

import { searchSongs } from '@/lib/itunes';

import { queryKeys } from '../keys';

/** Shortest (trimmed) term that triggers a search. */
export const SONG_SEARCH_MIN_LENGTH = 2;
const SONG_SEARCH_CACHE_MS = 10 * 60_000;

/**
 * Searches songs for a term. Debounce the term before passing it (see `useDebouncedValue`);
 * changing it aborts the stale request.
 *
 * @param term - The search text; it is trimmed, and the query stays disabled below 2 characters.
 * @returns The query; a failure is a `SearchUnavailableError` (never retried).
 */
export function useSongSearch(term: string) {
  const query = term.trim();
  return useQuery({
    queryKey: queryKeys.songSearch(query),
    queryFn: ({ signal }) => searchSongs(query, { signal }),
    enabled: query.length >= SONG_SEARCH_MIN_LENGTH,
    staleTime: SONG_SEARCH_CACHE_MS,
    gcTime: SONG_SEARCH_CACHE_MS,
    retry: false,
  });
}
