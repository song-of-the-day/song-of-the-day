/**
 * The log dialog's two forms — the manual song form and the details form — with client-side
 * checks that mirror the API's rules. The API stays the authority; its field
 * errors are shown on the same fields, because form fields are named after the request keys.
 */
import type { Entry } from '@/api/types';
import { compactErrors, type FieldErrorMap } from '@/features/auth/validation';
import { isIsoDate } from '@/lib/dates';
import { formatMs, parseTimestamp } from '@/lib/time';
import { parseYouTubeId, watchUrl } from '@/lib/youtube';

import type { SongDraft } from './songDraft';

/** Longest title, artist or album. */
export const TEXT_MAX_LENGTH = 300;
export const NOTE_MAX_LENGTH = 5000;
export const URL_MAX_LENGTH = 1000;
/** The earliest loggable day. */
export const MIN_ENTRY_DATE = '1900-01-01';
const MAX_DURATION_MS = 86_400_000;

export const MANUAL_FIELDS = ['title', 'artist', 'album', 'duration_ms', 'external_url'] as const;
export type ManualField = (typeof MANUAL_FIELDS)[number];
/** The manual song form's text, keyed by the API field each input fills (`duration_ms` is m:ss). */
export type ManualValues = Record<ManualField, string>;

export const DETAILS_FIELDS = ['entry_date', 'note', 'youtube_video_id'] as const;
export type DetailsField = (typeof DETAILS_FIELDS)[number];
/** The details form's text, keyed by API field (`youtube_video_id` is the pasted link). */
export type DetailsValues = Record<DetailsField, string>;

/** Validated details, ready for a payload. */
export interface EntryDetails {
  entry_date: string;
  /** Trimmed; `null` when empty. */
  note: string | null;
  youtube_video_id: string | null;
}

export const EMPTY_MANUAL_VALUES: ManualValues = {
  title: '',
  artist: '',
  album: '',
  duration_ms: '',
  external_url: '',
};

/** Counts code points, like the API's length limits (Python `len`). */
function lengthOf(value: string): number {
  return Array.from(value).length;
}

function tooLong(value: string, max: number): string | undefined {
  return lengthOf(value) > max ? `Use at most ${String(max)} characters.` : undefined;
}

function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== '';
}

/**
 * Fills the manual form from a song (to edit a manual song again).
 *
 * @param song - The song.
 * @returns The form text.
 */
export function manualValuesFromSong(song: SongDraft): ManualValues {
  return {
    title: song.title,
    artist: song.artist,
    album: song.album ?? '',
    duration_ms: song.duration_ms === null ? '' : formatMs(song.duration_ms),
    external_url: song.external_url ?? '',
  };
}

/**
 * Fills the details form from an entry (edit mode).
 *
 * @param entry - The entry being edited.
 * @returns The form text; a video id is shown as its watch link.
 */
export function detailsFromEntry(entry: Entry): DetailsValues {
  return {
    entry_date: entry.entry_date,
    note: entry.note ?? '',
    youtube_video_id: entry.youtube_video_id === null ? '' : watchUrl(entry.youtube_video_id),
  };
}

function checkRequired(value: string, missing: string): string | undefined {
  return value === '' ? missing : tooLong(value, TEXT_MAX_LENGTH);
}

/**
 * Parses a song's length, as the manual form's `m:ss` field.
 *
 * @param text - The field's text.
 * @returns The length in milliseconds (`null` when the field is empty), or an error message.
 */
export function checkLength(text: string): { error?: string; value: number | null } {
  if (text === '') {
    return { value: null };
  }
  const ms = parseTimestamp(text);
  if (ms === null) {
    return { error: 'Enter the length as m:ss, e.g. 3:45.', value: null };
  }
  if (ms === 0) {
    return { error: 'Enter a length longer than 0:00.', value: null };
  }
  if (ms > MAX_DURATION_MS) {
    return { error: 'Enter a length under 24 hours.', value: null };
  }
  return { value: ms };
}

function checkLink(link: string): string | undefined {
  if (link === '') {
    return undefined;
  }
  if (!isHttpUrl(link)) {
    return 'Enter a full link, starting with https://.';
  }
  return tooLong(link, URL_MAX_LENGTH);
}

/**
 * Checks the manual song form (text is trimmed, as the API does).
 *
 * @param values - The form text.
 * @returns Field errors, and the song when there are none.
 */
export function validateManualSong(values: ManualValues): {
  errors: FieldErrorMap<ManualField>;
  song: SongDraft | null;
} {
  const title = values.title.trim();
  const artist = values.artist.trim();
  const album = values.album.trim();
  const link = values.external_url.trim();
  const length = checkLength(values.duration_ms.trim());
  const errors = compactErrors<ManualField>({
    title: checkRequired(title, 'Enter the song title.'),
    artist: checkRequired(artist, 'Enter the artist.'),
    album: tooLong(album, TEXT_MAX_LENGTH),
    duration_ms: length.error,
    external_url: checkLink(link),
  });
  if (Object.keys(errors).length > 0) {
    return { errors, song: null };
  }
  return {
    errors,
    song: {
      source: 'manual',
      source_id: null,
      title,
      artist,
      album: album === '' ? null : album,
      artwork_url: null,
      preview_url: null,
      external_url: link === '' ? null : link,
      duration_ms: length.value,
    },
  };
}

function checkDate(date: string, today: string): string | undefined {
  if (date === '') {
    return 'Choose a date.';
  }
  if (!isIsoDate(date)) {
    return 'Enter a valid date.';
  }
  if (date < MIN_ENTRY_DATE) {
    return 'Choose a date in 1900 or later.';
  }
  return date > today ? 'Choose today or an earlier day.' : undefined;
}

/**
 * Checks the details form.
 *
 * @param values - The form text.
 * @param today - Today's date: later days can't be logged.
 * @returns Field errors, and the details when there are none.
 */
export function validateDetails(
  values: DetailsValues,
  today: string,
): { errors: FieldErrorMap<DetailsField>; details: EntryDetails | null } {
  const note = values.note.trim();
  const link = values.youtube_video_id.trim();
  const videoId = link === '' ? null : parseYouTubeId(link);
  const errors = compactErrors<DetailsField>({
    entry_date: checkDate(values.entry_date, today),
    note: tooLong(note, NOTE_MAX_LENGTH),
    youtube_video_id:
      link !== '' && videoId === null
        ? 'Paste a YouTube link, e.g. https://youtu.be/dQw4w9WgXcQ.'
        : undefined,
  });
  if (Object.keys(errors).length > 0) {
    return { errors, details: null };
  }
  return {
    errors,
    details: {
      entry_date: values.entry_date,
      note: note === '' ? null : note,
      youtube_video_id: videoId,
    },
  };
}
