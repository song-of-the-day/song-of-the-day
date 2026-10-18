/**
 * Which licensed player an entry gets.
 */
import type { Entry } from '@/api/types';

export type PlayerChoice =
  /** Full, synced playback from an attached YouTube video. */
  | { kind: 'youtube'; videoId: string }
  /** Apple's 30-second preview, streamed from its CDN. */
  | { kind: 'preview'; previewUrl: string }
  | { kind: 'none' };

/** The entry fields that decide the player. */
export type PlayerSource = Pick<Entry, 'youtube_video_id' | 'source' | 'preview_url'>;

/**
 * Picks the player for an entry. A YouTube video always wins. Otherwise an iTunes song with a
 * preview URL gets the Apple preview (`source_id` is not required; it only feeds the "Listen on"
 * row).
 *
 * @param entry - The entry's video, source and preview fields.
 * @returns The player to render.
 */
export function choosePlayer(entry: PlayerSource): PlayerChoice {
  if (entry.youtube_video_id !== null) {
    return { kind: 'youtube', videoId: entry.youtube_video_id };
  }
  if (entry.source === 'itunes' && entry.preview_url !== null) {
    return { kind: 'preview', previewUrl: entry.preview_url };
  }
  return { kind: 'none' };
}
