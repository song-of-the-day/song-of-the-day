/**
 * A stateful, in-memory fake of the whole HTTP API, served through MSW (see `server.ts`).
 *
 * Feature tests drive it like the real backend: seed data, sign a user in, render, interact, then
 * assert on the UI or on the fake's state. Every test starts from an empty fake (`setup.ts` calls
 * `fakeApi.reset()`). To force a specific response, override a route for one test:
 *
 * ```ts
 * server.use(http.post('/api/entries', () => apiErrorResponse(500, 'internal_error', 'Boom')));
 * ```
 *
 * Uploads: under Vitest's jsdom environment a `File` reaches the fake with its MIME type but
 * without its bytes or filename (Vitest's jsdom → undici FormData conversion drops them), so the
 * fake's type check (415) works while size-based errors (413) need a route override.
 */
import type { Annotation, Entry, EntryDetail, Upload, User, YouTubeMatchResult } from '@/api/types';
import { addDaysIso } from '@/lib/dates';

import { FakeDb, timestamp, todayUtc } from './fake/db';
import { createRoutes } from './fake/routes';

export { apiErrorResponse } from './fake/routes';
export { DEFAULT_PASSWORD } from './fake/db';

/** A request to `/api`, recorded for assertions (overridden routes included). */
export interface RecordedRequest {
  method: string;
  path: string;
  search: string;
  csrfToken: string | null;
}

const db = new FakeDb();
const requests: RecordedRequest[] = [];

/** The fake API's MSW handlers (installed by `server.ts`). */
export const fakeApiHandlers = createRoutes(db);

/**
 * Records a request if it targets `/api` (wired to MSW's `request:start` event by `server.ts`).
 *
 * @param request - Any intercepted request.
 */
export function recordApiRequest(request: Request): void {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) {
    requests.push({
      method: request.method,
      path: url.pathname,
      search: url.search,
      csrfToken: request.headers.get('X-CSRFToken'),
    });
  }
}

export interface SeedUserOptions extends Partial<Omit<User, 'id' | 'created_at'>> {
  password?: string;
}

export type SeedEntryOptions = Partial<Omit<Entry, 'id' | 'annotation_count'>>;
export type SeedAnnotationOptions = Partial<Omit<Annotation, 'id' | 'entry_id'>>;

function requireEntry(id: number) {
  const entry = db.entries.get(id);
  if (entry === undefined) {
    throw new Error(`fakeApi: no entry ${String(id)}`);
  }
  return entry;
}

export const fakeApi = {
  /** Empties all state, ends the session and clears the request log. */
  reset(): void {
    db.reset();
    requests.length = 0;
  },

  /** Every `/api` request since the last reset, in order. */
  get requests(): readonly RecordedRequest[] {
    return requests;
  },

  /** The CSRF token of the current session. */
  get csrfToken(): string {
    return db.csrfToken;
  },

  /** Id of the logged-in user, or `null`. */
  get currentUserId(): number | null {
    return db.sessionUserId;
  },

  /**
   * Creates a user (password {@link DEFAULT_PASSWORD} unless given).
   *
   * @returns The user as the API returns it.
   */
  seedUser(options: SeedUserOptions = {}): User {
    const { password, ...fields } = options;
    const id = db.nextId();
    const record = db.insertUser({
      ...FakeDb.newUserFields(),
      email: `user${String(id)}@example.com`,
      username: `user${String(id)}`,
      ...fields,
      ...(password === undefined ? {} : { password }),
    });
    return db.toUser(record);
  },

  /** Logs `userId` in, as if the browser held their session cookie (the CSRF token rotates). */
  signIn(userId: number): void {
    if (!db.users.has(userId)) {
      throw new Error(`fakeApi: no user ${String(userId)}`);
    }
    db.setSession(userId);
  },

  /** Ends the session, as if it expired. */
  signOut(): void {
    db.setSession(null);
  },

  /** The user with this username (case-insensitive), as the API would return it to its owner. */
  userByUsername(username: string): User | undefined {
    const record = db.userByUsername(username);
    return record === undefined ? undefined : db.toUser(record);
  },

  /** Whether the fake has a user with this id. */
  hasUser(userId: number): boolean {
    return db.users.has(userId);
  },

  /** The user as the API would return it. */
  getUser(userId: number): User | undefined {
    const record = db.users.get(userId);
    return record === undefined ? undefined : db.toUser(record);
  },

  /** The user's current password (to assert password changes). */
  passwordOf(userId: number): string | undefined {
    return db.users.get(userId)?.password;
  },

  /** The latest unused password-reset token for an email, as if read from the email. */
  resetTokenFor(email: string): string | undefined {
    const user = db.userByEmail(email);
    return [...db.resetTokens].findLast(([, userId]) => userId === user?.id)?.[0];
  },

  /**
   * Creates an entry for a user (an iTunes song dated today in UTC unless overridden).
   *
   * @returns The entry with its annotations.
   */
  seedEntry(userId: number, overrides: SeedEntryOptions = {}): EntryDetail {
    const now = timestamp();
    const record = db.insertEntry(userId, {
      entry_date: todayUtc(),
      title: 'Gosh',
      artist: 'Jamie xx',
      album: 'In Colour',
      artwork_url: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/b9/dc/ce/600x600bb.jpg',
      preview_url: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/preview.m4a',
      external_url: 'https://music.apple.com/us/album/gosh/1525506447?i=1525506452',
      youtube_video_id: null,
      duration_ms: 290973,
      source: 'itunes',
      source_id: '1525506452',
      note: null,
      created_at: now,
      updated_at: now,
      ...overrides,
    });
    return db.toEntryDetail(record);
  },

  /**
   * Creates `count` entries on consecutive days ending at `endDate`, newest first.
   *
   * @returns The entries, newest first.
   */
  seedEntries(userId: number, count: number, endDate: string = todayUtc()): Entry[] {
    return Array.from({ length: count }, (_, index) => {
      const detail = fakeApi.seedEntry(userId, {
        entry_date: addDaysIso(endDate, -index),
        title: `Song ${String(index + 1)}`,
      });
      return db.toEntry(requireEntry(detail.id));
    });
  },

  /** Creates an annotation on an entry. */
  seedAnnotation(entryId: number, overrides: SeedAnnotationOptions = {}): Annotation {
    requireEntry(entryId);
    const now = timestamp();
    return db.insertAnnotation({
      entry_id: entryId,
      start_ms: 60000,
      end_ms: null,
      body: 'love this part',
      color: 'yellow',
      created_at: now,
      updated_at: now,
      ...overrides,
    });
  },

  /** Stores an upload for a user. */
  seedUpload(userId: number, byteSize = 1024): Upload {
    return db.toUpload(db.insertUpload(userId, byteSize));
  },

  /** Sets what the YouTube auto-matcher answers. */
  setYouTubeMatch(result: YouTubeMatchResult): void {
    db.youtubeMatch = result;
  },

  /** Whether an upload exists. */
  hasUpload(id: string): boolean {
    return db.uploads.has(id);
  },

  /** An entry with its annotations, as the API would return it. */
  getEntry(id: number): EntryDetail | undefined {
    const record = db.entries.get(id);
    return record === undefined ? undefined : db.toEntryDetail(record);
  },

  /** A user's entries, newest first. */
  entriesOf(userId: number): Entry[] {
    return db.entriesOf(userId).map((record) => db.toEntry(record));
  },
};

export type FakeApi = typeof fakeApi;
