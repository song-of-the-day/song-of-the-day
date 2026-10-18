/**
 * In-memory state of the fake API: users, the browser's session, entries, annotations, uploads
 * and password-reset tokens.
 *
 * The fake models a single browser, so "the session" is the one cookie jar the tests share:
 * `sessionUserId` is who is logged in and `csrfToken` is the token bound to that session.
 */
import type {
  Annotation,
  Entry,
  EntryDetail,
  PublicProfile,
  Upload,
  User,
  YouTubeMatchResult,
} from '@/api/types';
import { defaultTheme, type Theme } from '@/lib/theme';

/** Password of seeded users unless a test chooses another. */
export const DEFAULT_PASSWORD = 'correct horse battery';

export interface UserRecord {
  id: number;
  email: string;
  /** Normalized (lower-case); unique. */
  username: string;
  password: string;
  display_name: string;
  bio: string;
  theme: Theme;
  autoplay_previews: boolean;
  created_at: string;
}

export type EntryRecord = Omit<Entry, 'annotation_count'> & { user_id: number };
export type UploadRecord = Upload & { user_id: number };

/** An API timestamp for now: ISO 8601 UTC without milliseconds. */
export function timestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Today's UTC date, which the API uses to bound `entry_date`. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function cloneTheme(theme: Theme): Theme {
  return {
    ...theme,
    colors: { ...theme.colors },
    fonts: { ...theme.fonts },
    background: { ...theme.background },
  };
}

export class FakeDb {
  users = new Map<number, UserRecord>();
  entries = new Map<number, EntryRecord>();
  annotations = new Map<number, Annotation>();
  uploads = new Map<string, UploadRecord>();
  resetTokens = new Map<string, number>();
  /** What the YouTube auto-matcher answers; disabled until seeded. */
  youtubeMatch: YouTubeMatchResult = { match: null, reason: 'disabled' };
  sessionUserId: number | null = null;
  csrfToken = '';
  private sequence = 0;

  constructor() {
    this.reset();
  }

  /** Empties every table and starts a fresh anonymous session. */
  reset(): void {
    this.users.clear();
    this.entries.clear();
    this.annotations.clear();
    this.uploads.clear();
    this.resetTokens.clear();
    this.youtubeMatch = { match: null, reason: 'disabled' };
    this.sessionUserId = null;
    this.sequence = 0;
    this.rotateCsrfToken();
  }

  /** A new id, unique across all tables (keeps ids distinct between resource types). */
  nextId(): number {
    this.sequence += 1;
    return this.sequence;
  }

  /** Replaces the session's CSRF token, as clearing the Flask session does. */
  rotateCsrfToken(): void {
    this.csrfToken = `csrf-${String(this.nextId())}`;
  }

  /** Starts a session for `userId` (or ends it with `null`); the CSRF token rotates. */
  setSession(userId: number | null): void {
    this.sessionUserId = userId;
    this.rotateCsrfToken();
  }

  currentUser(): UserRecord | null {
    return this.sessionUserId === null ? null : (this.users.get(this.sessionUserId) ?? null);
  }

  /** The user with this username, compared case-insensitively like the API. */
  userByUsername(username: string): UserRecord | undefined {
    const normalized = username.trim().toLowerCase();
    return [...this.users.values()].find((user) => user.username === normalized);
  }

  userByEmail(email: string): UserRecord | undefined {
    const normalized = email.trim().toLowerCase();
    return [...this.users.values()].find((user) => user.email === normalized);
  }

  insertUser(fields: Omit<UserRecord, 'id' | 'created_at'>): UserRecord {
    const record: UserRecord = {
      ...fields,
      theme: cloneTheme(fields.theme),
      id: this.nextId(),
      created_at: timestamp(),
    };
    this.users.set(record.id, record);
    return record;
  }

  deleteUser(id: number): void {
    for (const entry of this.entriesOf(id)) {
      this.deleteEntry(entry.id);
    }
    for (const upload of [...this.uploads.values()]) {
      if (upload.user_id === id) {
        this.uploads.delete(upload.id);
      }
    }
    for (const [token, userId] of this.resetTokens) {
      if (userId === id) {
        this.resetTokens.delete(token);
      }
    }
    this.users.delete(id);
  }

  toUser(record: UserRecord): User {
    return {
      id: record.id,
      email: record.email,
      username: record.username,
      display_name: record.display_name,
      bio: record.bio,
      theme: cloneTheme(record.theme),
      autoplay_previews: record.autoplay_previews,
      created_at: record.created_at,
    };
  }

  /** What anyone with the link sees of a user (no email, id or account settings). */
  toPublicProfile(record: UserRecord): PublicProfile {
    return {
      username: record.username,
      display_name: record.display_name,
      bio: record.bio,
      theme: cloneTheme(record.theme),
      created_at: record.created_at,
    };
  }

  /** The user's entries, newest first. */
  entriesOf(userId: number): EntryRecord[] {
    return [...this.entries.values()]
      .filter((entry) => entry.user_id === userId)
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  }

  /** The entry, if it exists and belongs to `userId`. */
  ownedEntry(userId: number, id: number): EntryRecord | undefined {
    const entry = this.entries.get(id);
    return entry?.user_id === userId ? entry : undefined;
  }

  insertEntry(userId: number, fields: Omit<EntryRecord, 'id' | 'user_id'>): EntryRecord {
    const record: EntryRecord = { ...fields, id: this.nextId(), user_id: userId };
    this.entries.set(record.id, record);
    return record;
  }

  deleteEntry(id: number): void {
    for (const annotation of this.annotationsOf(id)) {
      this.annotations.delete(annotation.id);
    }
    this.entries.delete(id);
  }

  /** The entry's annotations sorted by `start_ms`, then `id`. */
  annotationsOf(entryId: number): Annotation[] {
    return [...this.annotations.values()]
      .filter((annotation) => annotation.entry_id === entryId)
      .sort((a, b) => a.start_ms - b.start_ms || a.id - b.id);
  }

  insertAnnotation(fields: Omit<Annotation, 'id'>): Annotation {
    const record: Annotation = { ...fields, id: this.nextId() };
    this.annotations.set(record.id, record);
    return record;
  }

  toEntry(record: EntryRecord): Entry {
    const { user_id: _userId, ...entry } = record;
    return { ...entry, annotation_count: this.annotationsOf(record.id).length };
  }

  toEntryDetail(record: EntryRecord): EntryDetail {
    return {
      ...this.toEntry(record),
      annotations: this.annotationsOf(record.id).map((annotation) => ({ ...annotation })),
    };
  }

  insertUpload(userId: number, byteSize: number): UploadRecord {
    const sequence = String(this.nextId()).padStart(12, '0');
    const id = `00000000-0000-4000-8000-${sequence}`;
    const record: UploadRecord = {
      id,
      url: `/api/uploads/${id}`,
      content_type: 'image/webp',
      byte_size: byteSize,
      width: 1600,
      height: 900,
      created_at: timestamp(),
      user_id: userId,
    };
    this.uploads.set(id, record);
    return record;
  }

  toUpload(record: UploadRecord): Upload {
    const { user_id: _userId, ...upload } = record;
    return { ...upload };
  }

  /**
   * Deletes the user's uploads that neither the saved theme nor `keepId` references (the API
   * keeps at most the saved image and the latest draft).
   */
  pruneUploads(userId: number, keepId: string | null): void {
    const saved = this.users.get(userId)?.theme.background.image_upload_id ?? null;
    for (const upload of [...this.uploads.values()]) {
      if (upload.user_id === userId && upload.id !== saved && upload.id !== keepId) {
        this.uploads.delete(upload.id);
      }
    }
  }

  /** Default fields for a new user (used by seeding). */
  static newUserFields(): Omit<UserRecord, 'id' | 'created_at' | 'email' | 'username'> {
    return {
      password: DEFAULT_PASSWORD,
      display_name: 'Ada',
      bio: '',
      theme: defaultTheme(),
      autoplay_previews: true,
    };
  }
}
