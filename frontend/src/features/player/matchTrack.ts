/**
 * Describing a song to the YouTube auto-matcher.
 */
import type { YouTubeMatchQuery } from '@/api/types';

/** The song fields the matcher needs; both `SongDraft` and `Entry` have them. */
export interface MatchableSong {
  title: string;
  artist: string;
  album: string | null;
  duration_ms: number | null;
  source_id: string | null;
}

/**
 * Builds the matcher's query for a song.
 *
 * @param song - The song.
 * @returns The track query, with absent optionals left out.
 */
export function matchTrack(song: MatchableSong): YouTubeMatchQuery {
  return {
    title: song.title,
    artist: song.artist,
    album: song.album ?? undefined,
    duration_ms: song.duration_ms ?? undefined,
    source_id: song.source_id ?? undefined,
  };
}
