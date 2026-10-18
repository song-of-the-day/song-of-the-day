/**
 * Resource, input and response types of the HTTP API.
 *
 * Input types encode PATCH semantics: an omitted field is unchanged, and only fields that are
 * optional on the resource accept `null` (which clears them).
 */
import type { NoteColorKey, Theme } from '@/lib/theme';

export type { Theme } from '@/lib/theme';

/** An ISO calendar date, `yyyy-MM-dd`. */
export type IsoDate = string;
/** An ISO 8601 UTC timestamp, e.g. `2026-10-11T18:04:05Z`. */
export type Timestamp = string;

/** The logged-in user, only ever returned to its owner. */
export interface User {
  id: number;
  email: string;
  /** Unique, lower-case; names the public profile URL `/<username>`. */
  username: string;
  display_name: string;
  bio: string;
  theme: Theme;
  /** Auto-play players and previews when opening entries or picking songs (default `true`). */
  autoplay_previews: boolean;
  created_at: Timestamp;
}

/** What anyone with the link sees of a profile (`GET /api/users/<username>`). */
export interface PublicProfile {
  username: string;
  display_name: string;
  bio: string;
  theme: Theme;
  created_at: Timestamp;
}

export type EntrySource = 'itunes' | 'manual';

export interface Entry {
  id: number;
  entry_date: IsoDate;
  title: string;
  artist: string;
  album: string | null;
  artwork_url: string | null;
  preview_url: string | null;
  external_url: string | null;
  youtube_video_id: string | null;
  duration_ms: number | null;
  source: EntrySource;
  source_id: string | null;
  note: string | null;
  annotation_count: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Annotation {
  id: number;
  entry_id: number;
  start_ms: number;
  /** `null` for a point note. */
  end_ms: number | null;
  body: string;
  color: NoteColorKey;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** An entry with its annotations, sorted by `start_ms` then `id`. */
export interface EntryDetail extends Entry {
  annotations: Annotation[];
}

export interface Upload {
  id: string;
  /** Same-origin URL that serves the image to its owner. */
  url: string;
  content_type: string;
  byte_size: number;
  width: number;
  height: number;
  created_at: Timestamp;
}

/** One page of `GET /api/entries`, newest first. */
export interface EntriesPage {
  entries: Entry[];
  /** Cursor for the next page (`?before=`), or `null` when nothing older matches. */
  next_before: IsoDate | null;
}

export interface EntriesQuery {
  /** Inclusive lower bound. */
  start?: IsoDate;
  /** Inclusive upper bound. */
  end?: IsoDate;
  /** Exclusive upper bound (pagination cursor). */
  before?: IsoDate;
  /** 1–366, default 60. */
  limit?: number;
}

/** Why the YouTube matcher returned no video. */
export type YouTubeMatchReason =
  'matched' | 'no_match' | 'disabled' | 'quota_exhausted' | 'upstream_error';

/** The video the server's auto-matcher suggests for a song. */
export interface YouTubeMatch {
  video_id: string;
  /** The video's title, e.g. "Jamie xx - Gosh". */
  title: string;
  /** The channel it is on, e.g. "Jamie xx - Topic". */
  channel_title: string;
  duration_ms: number | null;
  /** The scorer's 0–1 confidence; `"high"` at ≥ 0.85. */
  score: number;
  confidence: 'high' | 'medium';
}

/** The auto-matcher's answer: a suggestion, or the reason there is none. */
export interface YouTubeMatchResult {
  match: YouTubeMatch | null;
  reason: YouTubeMatchReason;
}

/** Identifies a track to the auto-matcher (`GET /api/songs/youtube-match`). */
export interface YouTubeMatchQuery {
  title: string;
  artist: string;
  /** Accepted but unused in matching. */
  album?: string;
  duration_ms?: number;
  /** The iTunes `trackId`, when the song came from search. */
  source_id?: string;
  /** ISO 3166-1 alpha-2 code of the listener, for region blocks. */
  country?: string;
}

/** Song fields shared by entry create and update payloads. */
interface EntrySongFields {
  album?: string | null;
  artwork_url?: string | null;
  preview_url?: string | null;
  external_url?: string | null;
  duration_ms?: number | null;
  source_id?: string | null;
}

export interface EntryCreateInput extends EntrySongFields {
  entry_date: IsoDate;
  title: string;
  artist: string;
  youtube_video_id?: string | null;
  /** Defaults to `"manual"`. */
  source?: EntrySource;
  note?: string | null;
}

export interface EntryPatch extends EntrySongFields {
  entry_date?: IsoDate;
  title?: string;
  artist?: string;
  youtube_video_id?: string | null;
  source?: EntrySource;
  note?: string | null;
}

export interface AnnotationCreateInput {
  start_ms: number;
  end_ms?: number | null;
  body: string;
  /** Defaults to `"yellow"`. */
  color?: NoteColorKey;
}

export interface AnnotationPatch {
  start_ms?: number;
  /** `null` turns a range into a point. */
  end_ms?: number | null;
  body?: string;
  color?: NoteColorKey;
}

export interface ProfilePatch {
  /** Normalized (trimmed, lower-cased) by the API; `409 username_taken` when in use. */
  username?: string;
  display_name?: string;
  /** `null` or empty is stored as `""`. */
  bio?: string | null;
  /** Must be complete. */
  theme?: Theme;
  autoplay_previews?: boolean;
}

export interface SignupInput {
  email: string;
  password: string;
  /** Normalized (trimmed, lower-cased) by the API; `409 username_taken` when in use. */
  username: string;
}

export interface LoginInput {
  email: string;
  password: string;
  /** "Keep me logged in"; defaults to `true`. */
  remember?: boolean;
}

export interface PasswordResetRequestInput {
  email: string;
}

export interface PasswordResetConfirmInput {
  token: string;
  password: string;
}

export interface ChangePasswordInput {
  current_password: string;
  new_password: string;
}

export interface DeleteAccountInput {
  password: string;
}

/** A downloaded data export. */
export interface ExportFile {
  blob: Blob;
  filename: string;
}

/** The JSON body of every API error response. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    request_id?: string;
    existing_entry_id?: number;
    [key: string]: unknown;
  };
}
