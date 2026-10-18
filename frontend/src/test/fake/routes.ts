/**
 * MSW handlers implementing the fake API on top of {@link FakeDb}. Behavior follows the real API:
 * CSRF before auth, auth before body parsing, `415`/`400` for bad bodies, `422` field errors,
 * `404` for other users' resources, `409 entry_exists` with `existing_entry_id`, `409
 * username_taken`, and the public, read-only `/api/users/<username>/…` profile reads.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';

import type { Annotation, EntrySource, Theme } from '@/api/types';
import { addDaysIso, isIsoDate } from '@/lib/dates';
import { normalizeUsername, usernameTakenMessage, validateUsername } from '@/lib/username';
import {
  CARD_STYLE_KEYS,
  CUSTOM_PRESET,
  DEFAULT_VIEW_KEYS,
  defaultTheme,
  FONT_KEYS,
  IMAGE_FIT_KEYS,
  NOTE_COLOR_KEYS,
  PATTERN_KEYS,
  PRESET_KEYS,
} from '@/lib/theme';

import { timestamp, todayUtc, type EntryRecord, type FakeDb, type UserRecord } from './db';
import {
  FieldErrors,
  isAllowedUrl,
  isBody,
  MESSAGES,
  readEmail,
  readEnum,
  readInteger,
  readPassword,
  readString,
  rejectUnknown,
  type Body,
} from './validation';

const MAX_MS = 86_400_000;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ANNOTATION_LIMIT = 200;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const ID = /^\d+$/;
const SONG_TEXT_MAX = 300;
const SOURCE_ID_MAX = 64;
const MATCH_QUERY_FIELDS = ['title', 'artist', 'album', 'duration_ms', 'source_id', 'country'];
const ENTRY_FIELDS = [
  'entry_date',
  'title',
  'artist',
  'album',
  'artwork_url',
  'preview_url',
  'external_url',
  'youtube_video_id',
  'duration_ms',
  'source',
  'source_id',
  'note',
];
const ENTRY_SOURCES: readonly EntrySource[] = ['itunes', 'manual'];

/**
 * Builds an API error response.
 *
 * @param status - HTTP status.
 * @param code - The `error.code`.
 * @param message - The `error.message`.
 * @param extra - Other `error` keys (`fields`, `existing_entry_id`, `request_id`, …).
 */
export function apiErrorResponse(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return HttpResponse.json({ error: { code, message, ...extra } }, { status });
}

function validationError(errors: FieldErrors) {
  return apiErrorResponse(422, 'validation_error', 'Some fields are invalid.', {
    fields: errors.errors,
  });
}

function noContent() {
  return new HttpResponse(null, { status: 204 });
}

function notFound() {
  return apiErrorResponse(404, 'not_found', 'Not found.');
}

function parseId(value: string | readonly string[] | undefined): number | null {
  return typeof value === 'string' && ID.test(value) ? Number(value) : null;
}

async function readBody(request: Request): Promise<Body | Response> {
  const text = await request.text();
  if (text.trim() === '') {
    return {};
  }
  if (!(request.headers.get('Content-Type') ?? '').includes('application/json')) {
    return apiErrorResponse(415, 'unsupported_media_type', 'Send the body as application/json.');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return apiErrorResponse(400, 'invalid_json', 'The request body is not valid JSON.');
  }
  return isBody(value)
    ? value
    : apiErrorResponse(400, 'invalid_json', 'The request body must be a JSON object.');
}

function readThemeKey<K extends string>(
  group: Body,
  key: string,
  allowed: readonly K[],
  path: string,
  errors: FieldErrors,
): K | undefined {
  const value = group[key];
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    errors.add(`${path}.${key}`, value === undefined ? MESSAGES.required : 'Unknown option.');
  }
  return match;
}

function readGroup(theme: Body, key: string, keys: readonly string[], errors: FieldErrors) {
  const group = theme[key];
  if (!isBody(group)) {
    errors.add(`theme.${key}`, MESSAGES.required);
    return {};
  }
  rejectUnknown(group, keys, errors, `theme.${key}.`);
  return group;
}

function validateTheme(
  db: FakeDb,
  userId: number,
  raw: unknown,
  errors: FieldErrors,
): Theme | undefined {
  if (!isBody(raw)) {
    errors.add('theme', 'Must be a complete theme.');
    return undefined;
  }
  const keys = ['preset', 'colors', 'fonts', 'background', 'card_style', 'default_view'];
  rejectUnknown(raw, keys, errors, 'theme.');
  const preset = readThemeKey(raw, 'preset', [...PRESET_KEYS, CUSTOM_PRESET], 'theme', errors);
  const colorRoles = ['background', 'surface', 'text', 'accent', 'border'] as const;
  const colorsRaw = readGroup(raw, 'colors', colorRoles, errors);
  const colors = Object.fromEntries(
    colorRoles.map((role) => {
      const value = colorsRaw[role];
      if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
        errors.add(`theme.colors.${role}`, 'Must be a #RRGGBB color.');
        return [role, ''];
      }
      return [role, value.toUpperCase()];
    }),
  );
  const fontsRaw = readGroup(raw, 'fonts', ['heading', 'body'], errors);
  const heading = readThemeKey(fontsRaw, 'heading', FONT_KEYS, 'theme.fonts', errors);
  const body = readThemeKey(fontsRaw, 'body', FONT_KEYS, 'theme.fonts', errors);
  const backgroundKeys = ['pattern', 'image_upload_id', 'image_fit'];
  const backgroundRaw = readGroup(raw, 'background', backgroundKeys, errors);
  const pattern = readThemeKey(backgroundRaw, 'pattern', PATTERN_KEYS, 'theme.background', errors);
  const fit = readThemeKey(backgroundRaw, 'image_fit', IMAGE_FIT_KEYS, 'theme.background', errors);
  const imageId = backgroundRaw.image_upload_id;
  const upload = typeof imageId === 'string' ? db.uploads.get(imageId) : undefined;
  if (imageId !== null && upload?.user_id !== userId) {
    errors.add(
      'theme.background.image_upload_id',
      'This image is no longer available; upload it again.',
    );
  }
  const cardStyle = readThemeKey(raw, 'card_style', CARD_STYLE_KEYS, 'theme', errors);
  const defaultView = readThemeKey(raw, 'default_view', DEFAULT_VIEW_KEYS, 'theme', errors);
  if (
    !errors.empty ||
    preset === undefined ||
    heading === undefined ||
    body === undefined ||
    pattern === undefined ||
    fit === undefined ||
    cardStyle === undefined ||
    defaultView === undefined
  ) {
    return undefined;
  }
  return {
    preset,
    colors: { ...defaultTheme().colors, ...colors },
    fonts: { heading, body },
    background: { pattern, image_upload_id: upload?.id ?? null, image_fit: fit },
    card_style: cardStyle,
    default_view: defaultView,
  };
}

type EntryValues = Partial<Omit<EntryRecord, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

function readUrl(
  body: Body,
  key: string,
  errors: FieldErrors,
  protocols: readonly string[],
  hosts?: readonly string[],
): string | null | undefined {
  const value = readString(body, key, { nullable: true, max: 1000 }, errors);
  if (typeof value === 'string' && !isAllowedUrl(value, protocols, hosts)) {
    errors.add(key, 'Enter a valid URL.');
    return undefined;
  }
  return value;
}

function validateEntry(body: Body, create: boolean): { values: EntryValues; errors: FieldErrors } {
  const errors = new FieldErrors();
  rejectUnknown(body, ENTRY_FIELDS, errors);
  const values: EntryValues = {};
  if (create || 'entry_date' in body) {
    const raw = body.entry_date;
    if (raw === undefined) {
      errors.add('entry_date', MESSAGES.required);
    } else if (raw === null) {
      errors.add('entry_date', MESSAGES.notNull);
    } else if (typeof raw !== 'string' || !isIsoDate(raw)) {
      errors.add('entry_date', 'Enter a valid date.');
    } else if (raw < '1900-01-01' || raw > addDaysIso(todayUtc(), 1)) {
      errors.add('entry_date', 'Date is out of range.');
    } else {
      values.entry_date = raw;
    }
  }
  const title = readString(body, 'title', { required: create, min: 1, max: 300 }, errors);
  const artist = readString(body, 'artist', { required: create, min: 1, max: 300 }, errors);
  const album = readString(body, 'album', { nullable: true, max: 300 }, errors);
  const artwork = readUrl(body, 'artwork_url', errors, ['https:'], ['mzstatic.com']);
  const preview = readUrl(
    body,
    'preview_url',
    errors,
    ['https:'],
    ['itunes.apple.com', 'mzstatic.com'],
  );
  const external = readUrl(body, 'external_url', errors, ['https:', 'http:']);
  const videoId = readString(body, 'youtube_video_id', { nullable: true, max: 11 }, errors);
  if (typeof videoId === 'string' && !VIDEO_ID.test(videoId)) {
    errors.add('youtube_video_id', 'Enter a valid YouTube video id.');
  }
  const duration = readInteger(
    body,
    'duration_ms',
    { nullable: true, min: 1, max: MAX_MS },
    errors,
  );
  const source = readEnum(body, 'source', ENTRY_SOURCES, errors);
  const sourceId = readString(body, 'source_id', { nullable: true, max: 64 }, errors);
  const note = readString(body, 'note', { nullable: true, max: 5000, multiline: true }, errors);
  if (typeof title === 'string') values.title = title;
  if (typeof artist === 'string') values.artist = artist;
  if (album !== undefined) values.album = album;
  if (artwork !== undefined) values.artwork_url = artwork;
  if (preview !== undefined) values.preview_url = preview;
  if (external !== undefined) values.external_url = external;
  if (videoId !== undefined) values.youtube_video_id = videoId;
  if (duration !== undefined) values.duration_ms = duration;
  if (source !== undefined) values.source = source;
  if (sourceId !== undefined) values.source_id = sourceId;
  if (note !== undefined) values.note = note;
  return { values, errors };
}

function validateAnnotation(
  body: Body,
  existing: Annotation | null,
): { values: Partial<Annotation>; errors: FieldErrors } {
  const errors = new FieldErrors();
  const create = existing === null;
  rejectUnknown(body, ['start_ms', 'end_ms', 'body', 'color'], errors);
  const start = readInteger(body, 'start_ms', { required: create, min: 0, max: MAX_MS }, errors);
  const end = readInteger(body, 'end_ms', { nullable: true, min: 0, max: MAX_MS }, errors);
  const text = readString(
    body,
    'body',
    { required: create, min: 1, max: 1000, multiline: true },
    errors,
  );
  const color = readEnum(body, 'color', NOTE_COLOR_KEYS, errors);
  const values: Partial<Annotation> = {};
  if (typeof start === 'number') values.start_ms = start;
  if (end !== undefined) values.end_ms = end;
  if (typeof text === 'string') values.body = text;
  if (color !== undefined) values.color = color;
  const mergedStart = values.start_ms ?? existing?.start_ms;
  const mergedEnd = 'end_ms' in values ? values.end_ms : existing?.end_ms;
  if (
    errors.empty &&
    mergedStart !== undefined &&
    mergedEnd !== undefined &&
    mergedEnd !== null &&
    mergedEnd <= mergedStart
  ) {
    errors.add('end_ms', 'Must be greater than start_ms.');
  }
  return { values, errors };
}

interface MultipartFile {
  type: string;
  size: number;
}

/**
 * Reads one file part of a `multipart/form-data` body. (`Request.formData()` can't be used: under
 * jsdom, undici rejects the global `File` that jsdom installs.)
 *
 * @returns The part's type and byte size, `null` when there is no such file part, or `undefined`
 *   when the body is not multipart.
 */
async function readMultipartFile(
  request: Request,
  field: string,
): Promise<MultipartFile | null | undefined> {
  const boundary = /^multipart\/form-data;.*boundary=("?)([^";]+)\1/i.exec(
    request.headers.get('Content-Type') ?? '',
  )?.[2];
  if (boundary === undefined) {
    return undefined;
  }
  // latin1 maps every byte to one character, so string lengths are byte counts.
  const body = new TextDecoder('latin1').decode(await request.arrayBuffer());
  for (const part of body.split(`--${boundary}`)) {
    const headerEnd = part.indexOf('\r\n\r\n');
    const headers = part.slice(0, headerEnd);
    const disposition = /content-disposition:[^\r\n]*/i.exec(headers)?.[0] ?? '';
    if (
      headerEnd !== -1 &&
      disposition.includes(`name="${field}"`) &&
      disposition.includes('filename=')
    ) {
      const content = part.slice(headerEnd + 4).replace(/\r\n$/, '');
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim();
      return { type: type ?? 'application/octet-stream', size: content.length };
    }
  }
  return null;
}

function readDateParam(url: URL, key: string, errors: FieldErrors): string | undefined {
  const value = url.searchParams.get(key);
  if (value === null) {
    return undefined;
  }
  if (!isIsoDate(value)) {
    errors.add(key, 'Enter a valid date.');
    return undefined;
  }
  return value;
}

/**
 * Checks `GET /api/songs/youtube-match`'s query string like the API does: required `title`
 * and `artist`, a digit-only `duration_ms`, an upper-case two-letter `country`, nothing else.
 */
function checkMatchQuery(url: URL): FieldErrors {
  const errors = new FieldErrors();
  const params: Body = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    params[key] = values.length === 1 ? values[0] : values;
  }
  rejectUnknown(params, MATCH_QUERY_FIELDS, errors);
  readString(params, 'title', { required: true, min: 1, max: SONG_TEXT_MAX }, errors);
  readString(params, 'artist', { required: true, min: 1, max: SONG_TEXT_MAX }, errors);
  readString(params, 'album', { max: SONG_TEXT_MAX }, errors);
  readString(params, 'source_id', { max: SOURCE_ID_MAX }, errors);
  const duration = params.duration_ms;
  if (duration !== undefined) {
    if (typeof duration !== 'string' || !/^\d+$/.test(duration)) {
      errors.add('duration_ms', 'Must be an integer number of milliseconds.');
    } else if (Number(duration) < 1) {
      errors.add('duration_ms', 'Must be at least 1.');
    } else if (Number(duration) > MAX_MS) {
      errors.add('duration_ms', `Must be at most ${String(MAX_MS)}.`);
    }
  }
  const country = params.country;
  if (country !== undefined && (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country))) {
    errors.add('country', 'Must be a two-letter country code.');
  }
  return errors;
}

/**
 * Reads a username: a string, trimmed and lower-cased, checked against `shared/usernames.json`.
 *
 * @returns The normalized username, or `undefined` when absent or invalid.
 */
function readUsername(body: Body, required: boolean, errors: FieldErrors): string | undefined {
  // No length cap here: the shared rules report length problems with their own message.
  const value = readString(body, 'username', { required, max: Number.MAX_SAFE_INTEGER }, errors);
  if (typeof value !== 'string') {
    return undefined;
  }
  const message = validateUsername(value);
  if (message !== undefined) {
    errors.add('username', message);
    return undefined;
  }
  return normalizeUsername(value);
}

function usernameTaken(username: string) {
  return apiErrorResponse(409, 'username_taken', usernameTakenMessage(username));
}

/** Reads the query filters shared by `GET /api/entries` and the public entry list. */
function readEntriesQuery(url: URL): EntriesFilter | FieldErrors {
  const errors = new FieldErrors();
  const start = readDateParam(url, 'start', errors);
  const end = readDateParam(url, 'end', errors);
  const before = readDateParam(url, 'before', errors);
  const rawLimit = url.searchParams.get('limit') ?? '60';
  const limit = ID.test(rawLimit) ? Number(rawLimit) : Number.NaN;
  if (!(limit >= 1 && limit <= 366)) {
    errors.add('limit', 'Must be between 1 and 366.');
  }
  if (start !== undefined && end !== undefined && start > end) {
    errors.add('start', 'Must be on or before end.');
  }
  return errors.empty ? { start, end, before, limit } : errors;
}

interface EntriesFilter {
  start: string | undefined;
  end: string | undefined;
  before: string | undefined;
  limit: number;
}

function entriesPage(db: FakeDb, userId: number, filter: EntriesFilter) {
  const { start, end, before, limit } = filter;
  const matching = db
    .entriesOf(userId)
    .filter(
      (entry) =>
        (start === undefined || entry.entry_date >= start) &&
        (end === undefined || entry.entry_date <= end) &&
        (before === undefined || entry.entry_date < before),
    );
  const page = matching.slice(0, limit);
  const last = page.at(-1);
  return HttpResponse.json({
    entries: page.map((entry) => db.toEntry(entry)),
    next_before: matching.length > limit && last !== undefined ? last.entry_date : null,
  });
}

/**
 * Creates the fake API's handlers.
 *
 * @param db - The state to serve.
 * @returns The handlers, ending with a JSON 404 for unknown `/api` routes.
 */
export function createRoutes(db: FakeDb): HttpHandler[] {
  function checkCsrf(request: Request) {
    return request.headers.get('X-CSRFToken') === db.csrfToken
      ? null
      : apiErrorResponse(403, 'csrf_failed', 'The CSRF token is missing or invalid.');
  }

  /** Runs CSRF (for unsafe methods) and auth checks; returns the user or an error response. */
  function authorize(request: Request): UserRecord | Response {
    if (request.method !== 'GET') {
      const denied = checkCsrf(request);
      if (denied !== null) {
        return denied;
      }
    }
    return db.currentUser() ?? apiErrorResponse(401, 'unauthorized', 'Log in to continue.');
  }

  /** The user a public route names (case-insensitive), if any. */
  function publicUser(rawUsername: string | readonly string[] | undefined) {
    return typeof rawUsername === 'string' ? db.userByUsername(rawUsername) : undefined;
  }

  function ownedEntry(user: UserRecord, rawId: string | readonly string[] | undefined) {
    const id = parseId(rawId);
    return id === null ? undefined : db.ownedEntry(user.id, id);
  }

  return [
    http.get('/api/auth/csrf', () => HttpResponse.json({ csrf_token: db.csrfToken })),

    http.post('/api/auth/signup', async ({ request }) => {
      const denied = checkCsrf(request);
      if (denied !== null) return denied;
      const body = await readBody(request);
      if (body instanceof Response) return body;
      const errors = new FieldErrors();
      rejectUnknown(body, ['email', 'password', 'username'], errors);
      const email = readEmail(body, errors);
      const password = readPassword(body, 'password', errors);
      const username = readUsername(body, true, errors);
      if (
        !errors.empty ||
        email === undefined ||
        password === undefined ||
        username === undefined
      ) {
        return validationError(errors);
      }
      if (db.userByEmail(email) !== undefined) {
        return apiErrorResponse(409, 'email_taken', 'An account with this email already exists.');
      }
      if (db.userByUsername(username) !== undefined) {
        return usernameTaken(username);
      }
      const user = db.insertUser({
        email,
        username,
        password,
        display_name: username,
        bio: '',
        theme: defaultTheme(),
        autoplay_previews: true,
      });
      db.setSession(user.id);
      return HttpResponse.json({ user: db.toUser(user) }, { status: 201 });
    }),

    http.post('/api/auth/login', async ({ request }) => {
      const denied = checkCsrf(request);
      if (denied !== null) return denied;
      const body = await readBody(request);
      if (body instanceof Response) return body;
      const errors = new FieldErrors();
      rejectUnknown(body, ['email', 'password', 'remember'], errors);
      const email = readString(body, 'email', { required: true, max: 320 }, errors);
      const password = readString(
        body,
        'password',
        { required: true, max: 128, multiline: true, trim: false },
        errors,
      );
      if ('remember' in body && typeof body.remember !== 'boolean') {
        errors.add('remember', MESSAGES.boolean);
      }
      if (!errors.empty || typeof email !== 'string' || typeof password !== 'string') {
        return validationError(errors);
      }
      const user = db.userByEmail(email);
      if (user?.password !== password) {
        return apiErrorResponse(401, 'invalid_credentials', 'Incorrect email or password.');
      }
      db.setSession(user.id);
      return HttpResponse.json({ user: db.toUser(user) });
    }),

    http.post('/api/auth/logout', ({ request }) => {
      const denied = checkCsrf(request);
      if (denied !== null) return denied;
      db.setSession(null);
      return noContent();
    }),

    http.get('/api/auth/me', () => {
      const user = db.currentUser();
      return user === null
        ? apiErrorResponse(401, 'unauthorized', 'Log in to continue.')
        : HttpResponse.json({ user: db.toUser(user) });
    }),

    http.post('/api/auth/password-reset/request', async ({ request }) => {
      const denied = checkCsrf(request);
      if (denied !== null) return denied;
      const body = await readBody(request);
      if (body instanceof Response) return body;
      const errors = new FieldErrors();
      rejectUnknown(body, ['email'], errors);
      const email = readEmail(body, errors);
      if (!errors.empty || email === undefined) {
        return validationError(errors);
      }
      const user = db.userByEmail(email);
      if (user !== undefined) {
        db.resetTokens.set(`reset-${String(db.nextId())}`, user.id);
      }
      return HttpResponse.json({}, { status: 202 });
    }),

    http.post('/api/auth/password-reset/confirm', async ({ request }) => {
      const denied = checkCsrf(request);
      if (denied !== null) return denied;
      const body = await readBody(request);
      if (body instanceof Response) return body;
      const errors = new FieldErrors();
      rejectUnknown(body, ['token', 'password'], errors);
      const token = readString(body, 'token', { required: true, min: 1, max: 1000 }, errors);
      const password = readPassword(body, 'password', errors);
      if (!errors.empty || typeof token !== 'string' || password === undefined) {
        return validationError(errors);
      }
      const userId = db.resetTokens.get(token);
      const user = userId === undefined ? undefined : db.users.get(userId);
      if (user === undefined) {
        return apiErrorResponse(400, 'invalid_token', 'This reset link is invalid or has expired.');
      }
      user.password = password;
      for (const [candidate, owner] of db.resetTokens) {
        if (owner === user.id) db.resetTokens.delete(candidate);
      }
      if (db.sessionUserId === user.id) {
        db.setSession(null);
      }
      return noContent();
    }),

    http.post('/api/account/password', async ({ request }) => {
      const user = authorize(request);
      if (user instanceof Response) return user;
      const body = await readBody(request);
      if (body instanceof Response) return body;
      const errors = new FieldErrors();
      rejectUnknown(body, ['current_password', 'new_password'], errors);
      const current = readString(
        body,
        'current_password',
        { required: true, max: 128, multiline: true, trim: false },
        errors,
      );
      const next = readPassword(body, 'new_password', errors);
      if (!errors.empty || typeof current !== 'string' || next === undefined) {
        return validationError(errors);
      }
      if (current !== user.password) {
        return apiErrorResponse(401, 'invalid_credentials', 'Your current password is incorrect.');
      }
      user.password = next;
      return noContent();
    }),

    http.get('/api/account/export', ({ request }) => {
      const user = authorize(request);
      if (user instanceof Response) return user;
      const document = {
        format: 'sotd-export',
        version: 1,
        exported_at: timestamp(),
        user: {
          email: user.email,
          display_name: user.display_name,
          bio: user.bio,
          theme: user.theme,
          created_at: user.created_at,
        },
        entries: db.entriesOf(user.id).map((record) => {
          const { id: _id, annotation_count: _count, ...entry } = db.toEntry(record);
          return {
            ...entry,
            annotations: db.annotationsOf(record.id).map((annotation) => ({
              start_ms: annotation.start_ms,
              end_ms: annotation.end_ms,
              body: annotation.body,
              color: annotation.color,
              created_at: annotation.created_at,
            })),
          };
        }),
      };
      return HttpResponse.json(document, {
        headers: {
          'Content-Disposition': `attachment; filename="sotd-export-${todayUtc()}.json"`,
        },
      });
    }),

    http.delete('/api/account', async ({ request }) => {
      const user = authorize(request);
      if (user instanceof Response) return user;
      const body = await readBody(request);
      if (body instanceof Response) return body;
      const errors = new FieldErrors();
      rejectUnknown(body, ['password'], errors);
      const password = readString(
        body,
        'password',
        { required: true, max: 128, multiline: true, trim: false },
        errors,
      );
      if (!errors.empty || typeof password !== 'string') {
        return validationError(errors);
      }
      if (password !== user.password) {
        return apiErrorResponse(401, 'invalid_credentials', 'Incorrect password.');
      }
      db.deleteUser(user.id);
      db.setSession(null);
      return noContent();
    }),

    http.patch('/api/profile', async ({ request }) => {
      const user = authorize(request);
      if (user instanceof Response) return user;
      const body = await readBody(request);
      if (body instanceof Response) return body;
      const errors = new FieldErrors();
      rejectUnknown(
        body,
        ['username', 'display_name', 'bio', 'theme', 'autoplay_previews'],
        errors,
      );
      const username = readUsername(body, false, errors);
      const name = readString(body, 'display_name', { min: 1, max: 50 }, errors);
      const bio = readString(body, 'bio', { nullable: true, max: 280, multiline: true }, errors);
      const theme = 'theme' in body ? validateTheme(db, user.id, body.theme, errors) : undefined;
      const autoplay = body.autoplay_previews;
      if ('autoplay_previews' in body && typeof autoplay !== 'boolean') {
        errors.add('autoplay_previews', MESSAGES.boolean);
      }
      if (!errors.empty) {
        return validationError(errors);
      }
      if (username !== undefined) {
        const holder = db.userByUsername(username);
        if (holder !== undefined && holder.id !== user.id) {
          return usernameTaken(username);
        }
        user.username = username;
      }
      if (typeof name === 'string') user.display_name = name;
      if (bio !== undefined) user.bio = bio ?? '';
      if (theme !== undefined) user.theme = theme;
      if (typeof autoplay === 'boolean') user.autoplay_previews = autoplay;
      return HttpResponse.json({ user: db.toUser(user) });
    }),

    http.get('/api/entries', ({ request }) => {
      const user = authorize(request);
      if (user instanceof Response) return user;
      const filter = readEntriesQuery(new URL(request.url));
      return filter instanceof FieldErrors
        ? validationError(filter)
        : entriesPage(db, user.id, filter);
    }),

    http.post('/api/entries', async ({ request }) => {
      const user = authorize(request);
      if (user instanceof Response) return user;
      const body = await readBody(request);
      if (body instanceof Response) return body;
      const { values, errors } = validateEntry(body, true);
      const { entry_date: date, title, artist } = values;
      if (!errors.empty || date === undefined || title === undefined || artist === undefined) {
        return validationError(errors);
      }
      const existing = db.entriesOf(user.id).find((entry) => entry.entry_date === date);
      if (existing !== undefined) {
        return apiErrorResponse(409, 'entry_exists', 'You already logged a song for that day.', {
          existing_entry_id: existing.id,
        });
      }
      const now = timestamp();
      const record = db.insertEntry(user.id, {
        entry_date: date,
        title,
        artist,
        album: values.album ?? null,
        artwork_url: values.artwork_url ?? null,
        preview_url: values.preview_url ?? null,
        external_url: values.external_url ?? null,
        youtube_video_id: values.youtube_video_id ?? null,
        duration_ms: values.duration_ms ?? null,
        source: values.source ?? 'manual',
        source_id: values.source_id ?? null,
        note: values.note ?? null,
        created_at: now,
        updated_at: now,
      });
      return HttpResponse.json({ entry: db.toEntryDetail(record) }, { status: 201 });
    }),

    http.get('/api/entries/:id', ({ request, params }) => {
      const user = authorize(request);
      if (user instanceof Response) return user;
      const entry = ownedEntry(user, params.id);
      return entry === undefined
        ? notFound()
        : HttpResponse.json({ entry: db.toEntryDetail(entry) });
    }),

    http.patch('/api/entries/:id', async ({ request, params }) => {
      const user = authorize(request);
      if (user instanceof Response) return user;
      const entry = ownedEntry(user, params.id);
      if (entry === undefined) return notFound();
      const body = await readBody(request);
      if (body instanceof Response) return body;
      const { values, errors } = validateEntry(body, false);
      if (!errors.empty) {
        return validationError(errors);
      }
      const conflict = db
        .entriesOf(user.id)
        .find((other) => other.id !== entry.id && other.entry_date === values.entry_date);
      if (conflict !== undefined) {
        return apiErrorResponse(409, 'entry_exists', 'You already logged a song for that day.', {
          existing_entry_id: conflict.id,
        });
      }
      Object.assign(entry, values, { updated_at: timestamp() });
      return HttpResponse.json({ entry: db.toEntryDetail(entry) });
    }),

    http.delete('/api/entries/:id', ({ request, params }) => {
      const user = authorize(request);
      if (user instanceof Response) return user;
      const entry = ownedEntry(user, params.id);
      if (entry === undefined) return notFound();
      db.deleteEntry(entry.id);
      return noContent();
    }),

    http.get('/api/entries/:id/annotations', ({ request, params }) => {
      const user = authorize(request);
      if (user instanceof Response) return user;
      const entry = ownedEntry(user, params.id);
      return entry === undefined
        ? notFound()
        : HttpResponse.json({ annotations: db.annotationsOf(entry.id) });
    }),

    http.post('/api/entries/:id/annotations', async ({ request, params }) => {
      const user = authorize(request);
      if (user instanceof Response) return user;
      const entry = ownedEntry(user, params.id);
      if (entry === undefined) return notFound();
      const body = await readBody(request);
      if (body instanceof Response) return body;
      const { values, errors } = validateAnnotation(body, null);
      const { start_ms: start, body: text } = values;
      if (!errors.empty || start === undefined || text === undefined) {
        return validationError(errors);
      }
      if (db.annotationsOf(entry.id).length >= ANNOTATION_LIMIT) {
        return apiErrorResponse(
          422,
          'annotation_limit_reached',
          'This song already has 200 notes.',
        );
      }
      const now = timestamp();
      const annotation = db.insertAnnotation({
        entry_id: entry.id,
        start_ms: start,
        end_ms: values.end_ms ?? null,
        body: text,
        color: values.color ?? 'yellow',
        created_at: now,
        updated_at: now,
      });
      return HttpResponse.json({ annotation }, { status: 201 });
    }),

    http.patch('/api/entries/:id/annotations/:annotationId', async ({ request, params }) => {
      const user = authorize(request);
      if (user instanceof Response) return user;
      const entry = ownedEntry(user, params.id);
      const annotationId = parseId(params.annotationId);
      const annotation = annotationId === null ? undefined : db.annotations.get(annotationId);
      if (entry === undefined || annotation?.entry_id !== entry.id) return notFound();
      const body = await readBody(request);
      if (body instanceof Response) return body;
      const { values, errors } = validateAnnotation(body, annotation);
      if (!errors.empty) {
        return validationError(errors);
      }
      Object.assign(annotation, values, { updated_at: timestamp() });
      return HttpResponse.json({ annotation });
    }),

    http.delete('/api/entries/:id/annotations/:annotationId', ({ request, params }) => {
      const user = authorize(request);
      if (user instanceof Response) return user;
      const entry = ownedEntry(user, params.id);
      const annotationId = parseId(params.annotationId);
      const annotation = annotationId === null ? undefined : db.annotations.get(annotationId);
      if (entry === undefined || annotation?.entry_id !== entry.id) return notFound();
      db.annotations.delete(annotation.id);
      return noContent();
    }),

    http.get('/api/songs/youtube-match', ({ request }) => {
      const user = authorize(request);
      if (user instanceof Response) return user;
      const errors = checkMatchQuery(new URL(request.url));
      return errors.empty ? HttpResponse.json(db.youtubeMatch) : validationError(errors);
    }),

    http.post('/api/uploads', async ({ request }) => {
      const user = authorize(request);
      if (user instanceof Response) return user;
      const file = await readMultipartFile(request, 'file');
      if (file === undefined) {
        return apiErrorResponse(
          415,
          'unsupported_media_type',
          'Send the image as multipart/form-data.',
        );
      }
      if (file === null) {
        const errors = new FieldErrors();
        errors.add('file', 'Choose an image to upload.');
        return validationError(errors);
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return apiErrorResponse(413, 'payload_too_large', 'File is too large.');
      }
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        return apiErrorResponse(
          415,
          'unsupported_media_type',
          'Use a JPEG, PNG, WebP or GIF image.',
        );
      }
      const upload = db.insertUpload(user.id, file.size);
      db.pruneUploads(user.id, upload.id);
      return HttpResponse.json({ upload: db.toUpload(upload) }, { status: 201 });
    }),

    http.get('/api/users/:username', ({ params }) => {
      const owner = publicUser(params.username);
      return owner === undefined
        ? notFound()
        : HttpResponse.json({ profile: db.toPublicProfile(owner) });
    }),

    http.get('/api/users/:username/entries', ({ request, params }) => {
      const owner = publicUser(params.username);
      if (owner === undefined) return notFound();
      const filter = readEntriesQuery(new URL(request.url));
      return filter instanceof FieldErrors
        ? validationError(filter)
        : entriesPage(db, owner.id, filter);
    }),

    http.get('/api/users/:username/entries/:id', ({ params }) => {
      const owner = publicUser(params.username);
      const entry = owner === undefined ? undefined : ownedEntry(owner, params.id);
      return entry === undefined
        ? notFound()
        : HttpResponse.json({ entry: db.toEntryDetail(entry) });
    }),

    // Public while it is the owner's saved background; drafts are owner-only.
    http.get('/api/uploads/:id', ({ params }) => {
      const upload = typeof params.id === 'string' ? db.uploads.get(params.id) : undefined;
      const owner = upload === undefined ? undefined : db.users.get(upload.user_id);
      const visible =
        upload !== undefined &&
        (db.sessionUserId === upload.user_id ||
          owner?.theme.background.image_upload_id === upload.id);
      if (!visible) return notFound();
      return new HttpResponse(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
        headers: { 'Content-Type': upload.content_type },
      });
    }),

    http.all('/api/*', () => notFound()),
  ];
}
