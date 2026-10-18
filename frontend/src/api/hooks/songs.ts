/**
 * Query hook for the server's YouTube auto-match.
 */
import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '../keys';
import { getYouTubeMatch } from '../songs';
import type { YouTubeMatchQuery } from '../types';

/** How long the client keeps an answer before asking again; the server caches it too. */
const MATCH_CACHE_MS = 30 * 60_000;

/** The idle query key; used while there is no track to look up. */
const NO_TRACK: YouTubeMatchQuery = { title: '', artist: '' };

export interface YouTubeMatchOptions {
  /** Set `false` to stay idle, e.g. once the user attached a video. Defaults to `true`. */
  enabled?: boolean;
}

/**
 * Finds a song's YouTube video on the server, in the background.
 *
 * A lookup is a convenience, never a step the user has to complete: surface `data.match` subtly
 * when it arrives, and say nothing on failure. The manual link field always remains.
 *
 * @param track - The song to match; `null` (nothing chosen yet) keeps the hook idle.
 * @param options - Whether the lookup may run.
 * @returns The query; the suggestion is `data.match`, or `null` with a `reason`.
 */
export function useYouTubeMatch(
  track: YouTubeMatchQuery | null,
  options: YouTubeMatchOptions = {},
) {
  const wanted = (options.enabled ?? true) && track !== null;
  return useQuery({
    queryKey: queryKeys.youtubeMatch(track ?? NO_TRACK),
    queryFn: ({ signal }) => {
      if (track === null) {
        // Unreachable while `enabled` is computed above; narrows the type for the call.
        throw new Error('useYouTubeMatch: no track');
      }
      return getYouTubeMatch(track, signal);
    },
    enabled: wanted && track.title !== '' && track.artist !== '',
    staleTime: MATCH_CACHE_MS,
    gcTime: MATCH_CACHE_MS,
    retry: false,
  });
}
