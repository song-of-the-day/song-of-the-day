/**
 * Factories for API resources, songs and raw iTunes payloads. Each factory returns a complete,
 * valid object; pass overrides for the fields a test cares about.
 */
import type { Annotation, Entry, EntryDetail, User } from '@/api/types';
import type { SongResult } from '@/lib/itunes';
import { defaultTheme, withField, type Theme, type ThemeEdit } from '@/lib/theme';

/** The fixed "now" used by date-dependent tests (matches the backend's frozen time). */
export const FIXED_NOW = new Date('2026-10-11T12:00:00Z');
export const FIXED_TODAY = '2026-10-11';
export const TIMESTAMP = '2026-10-11T18:04:05Z';

let lastId = 1000;

/** Returns a fresh id, unique within the test file. */
export function nextId(): number {
  lastId += 1;
  return lastId;
}

/**
 * Builds a theme: the default preset, optionally edited (which marks it custom).
 *
 * @param edit - Fields to change.
 * @returns A complete theme.
 */
export function makeTheme(edit?: ThemeEdit): Theme {
  return edit === undefined ? defaultTheme() : withField(defaultTheme(), edit);
}

export function makeUser(overrides: Partial<User> = {}): User {
  const id = overrides.id ?? nextId();
  return {
    id,
    email: `user${String(id)}@example.com`,
    username: `user${String(id)}`,
    display_name: 'Ada',
    bio: 'currently obsessed with breakbeats',
    theme: defaultTheme(),
    autoplay_previews: true,
    created_at: TIMESTAMP,
    ...overrides,
  };
}

export function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: nextId(),
    entry_date: FIXED_TODAY,
    title: 'Gosh',
    artist: 'Jamie xx',
    album: 'In Colour',
    artwork_url: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/b9/dc/ce/600x600bb.jpg',
    preview_url:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/mzaf_674086647576238926.plus.aac.p.m4a',
    external_url: 'https://music.apple.com/us/album/gosh/1525506447?i=1525506452',
    youtube_video_id: 'dQw4w9WgXcQ',
    duration_ms: 290973,
    source: 'itunes',
    source_id: '1525506452',
    note: 'the build at 2:30 lives in my head rent free',
    annotation_count: 0,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  };
}

export function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: nextId(),
    entry_id: 1,
    start_ms: 150000,
    end_ms: 171500,
    body: 'the build',
    color: 'yellow',
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  };
}

/**
 * Builds an entry with annotations; `annotation_count` follows `annotations` unless overridden.
 */
export function makeEntryDetail(overrides: Partial<EntryDetail> = {}): EntryDetail {
  const id = overrides.id ?? nextId();
  const annotations = overrides.annotations ?? [];
  return {
    ...makeEntry({ id }),
    annotation_count: annotations.length,
    ...overrides,
    annotations,
  };
}

export function makeSongResult(overrides: Partial<SongResult> = {}): SongResult {
  return {
    source: 'itunes',
    source_id: '1525506452',
    title: 'Gosh',
    artist: 'Jamie xx',
    album: 'In Colour',
    artwork_url: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/b9/dc/ce/600x600bb.jpg',
    preview_url:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/mzaf_674086647576238926.plus.aac.p.m4a',
    external_url: 'https://music.apple.com/us/album/gosh/1525506447?i=1525506452',
    duration_ms: 290973,
    ...overrides,
  };
}

/** The subset of an iTunes Search API track result that the app reads (plus realistic extras). */
export interface ItunesTrack {
  wrapperType: 'track';
  kind: 'song';
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  trackViewUrl?: string;
  trackTimeMillis?: number;
  primaryGenreName?: string;
}

export function makeItunesTrack(overrides: Partial<ItunesTrack> = {}): ItunesTrack {
  return {
    wrapperType: 'track',
    kind: 'song',
    trackId: 1525506452,
    trackName: 'Gosh',
    artistName: 'Jamie xx',
    collectionName: 'In Colour',
    artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/b9/dc/ce/100x100bb.jpg',
    previewUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/mzaf_674086647576238926.plus.aac.p.m4a',
    trackViewUrl: 'https://music.apple.com/us/album/gosh/1525506447?i=1525506452&uo=4',
    trackTimeMillis: 290973,
    primaryGenreName: 'Electronic',
    ...overrides,
  };
}

/** A small catalog served by the fake iTunes search endpoint. */
export const ITUNES_CATALOG: readonly ItunesTrack[] = [
  makeItunesTrack(),
  makeItunesTrack({
    trackId: 1525506460,
    trackName: 'Loud Places',
    collectionName: 'In Colour',
    trackTimeMillis: 283000,
  }),
  makeItunesTrack({
    trackId: 1440806723,
    trackName: 'Windowlicker',
    artistName: 'Aphex Twin',
    collectionName: 'Windowlicker - EP',
    artworkUrl100: 'https://is2-ssl.mzstatic.com/image/thumb/Music/v4/aa/bb/cc/100x100bb.jpg',
    trackViewUrl: 'https://music.apple.com/us/album/windowlicker/1440806717?i=1440806723&uo=4',
    trackTimeMillis: 367000,
  }),
  makeItunesTrack({
    trackId: 1452859418,
    trackName: 'Teardrop',
    artistName: 'Massive Attack',
    collectionName: 'Mezzanine',
    artworkUrl100: 'https://is3-ssl.mzstatic.com/image/thumb/Music/v4/dd/ee/ff/100x100bb.jpg',
    trackViewUrl: 'https://music.apple.com/us/album/teardrop/1452859413?i=1452859418&uo=4',
    trackTimeMillis: 330000,
  }),
];

/**
 * Wraps tracks the way the iTunes Search API does.
 *
 * @param tracks - The results.
 * @returns `{ resultCount, results }`.
 */
export function makeItunesResponse(tracks: readonly unknown[]): {
  resultCount: number;
  results: readonly unknown[];
} {
  return { resultCount: tracks.length, results: tracks };
}
