/**
 * TanStack Query key factory. Every cache entry the app uses has its key
 * built here. Profile data is keyed by the (normalized) username, the same way for the owner and
 * for visitors, because the profile page always reads through the public endpoints.
 */
import type { IsoDate, YouTubeMatchQuery } from './types';

export const queryKeys = {
  /** The logged-in user (`User | null`). */
  me: () => ['me'] as const,
  /** Prefix of every profile's data. */
  users: () => ['users'] as const,
  /** Prefix of everything cached for one profile (removed when its username changes). */
  user: (username: string) => ['users', username] as const,
  /** A profile's public header and theme (`PublicProfile`). */
  profile: (username: string) => ['users', username, 'profile'] as const,
  /** Prefix of a profile's entry lists; invalidated by entry and annotation mutations. */
  entries: (username: string) => ['users', username, 'entries'] as const,
  /** A profile's board: the infinite list, paged with the `before` cursor. */
  board: (username: string) => ['users', username, 'entries', 'board'] as const,
  /** A profile's entries in an inclusive date range (calendar months and today's entry). */
  range: (username: string, start: IsoDate, end: IsoDate) =>
    ['users', username, 'entries', 'range', start, end] as const,
  /** One entry of a profile, with its annotations. */
  entry: (username: string, id: number) => ['users', username, 'entry', id] as const,
  /** iTunes search results for a trimmed term. */
  songSearch: (term: string) => ['song-search', term] as const,
  /**
   * The YouTube auto-match for a track. Keyed by the track itself, so
   * reopening the same song (in another dialog or entry) reuses the answer; the server caches
   * it too.
   */
  youtubeMatch: (track: YouTubeMatchQuery) => ['youtube-match', track] as const,
};
