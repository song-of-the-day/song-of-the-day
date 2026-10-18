/**
 * The song part of an entry, as chosen in the log dialog (a search result or a manual entry).
 */
import type { Entry, EntrySource } from '@/api/types';

/** An entry's song fields. A `SongResult` from search is one too. */
export interface SongDraft {
  source: EntrySource;
  /** The iTunes `trackId`, or `null` for manual songs. */
  source_id: string | null;
  title: string;
  artist: string;
  album: string | null;
  artwork_url: string | null;
  preview_url: string | null;
  external_url: string | null;
  duration_ms: number | null;
}

/** Every song field, in payload order. */
export const SONG_FIELDS = [
  'title',
  'artist',
  'album',
  'artwork_url',
  'preview_url',
  'external_url',
  'duration_ms',
  'source',
  'source_id',
] as const satisfies readonly (keyof SongDraft)[];

/**
 * Reads the song of an existing entry.
 *
 * @param entry - The entry.
 * @returns Its song fields.
 */
export function songFromEntry(entry: Entry): SongDraft {
  return {
    source: entry.source,
    source_id: entry.source_id,
    title: entry.title,
    artist: entry.artist,
    album: entry.album,
    artwork_url: entry.artwork_url,
    preview_url: entry.preview_url,
    external_url: entry.external_url,
    duration_ms: entry.duration_ms,
  };
}

/**
 * Compares two songs field by field.
 *
 * @param a - A song.
 * @param b - Another song.
 * @returns Whether every song field is equal.
 */
export function sameSong(a: SongDraft, b: SongDraft): boolean {
  return SONG_FIELDS.every((field) => a[field] === b[field]);
}

/**
 * Describes a song for a one-line summary.
 *
 * @param song - The song.
 * @returns E.g. "Jamie xx · In Colour".
 */
export function songByline(song: Pick<SongDraft, 'artist' | 'album'>): string {
  return song.album === null ? song.artist : `${song.artist} · ${song.album}`;
}
