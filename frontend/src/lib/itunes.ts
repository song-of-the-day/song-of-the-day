/**
 * Client-side song search against the iTunes Search API.
 *
 * Search runs in the browser because Apple rate-limits per client IP. Results are mapped to the
 * entry payload shape, and URLs the API would reject (wrong scheme or host, too long) are dropped.
 */

/** A search hit, shaped like the song fields of an entry payload. */
export interface SongResult {
  source: 'itunes';
  /** The iTunes `trackId`. */
  source_id: string;
  title: string;
  artist: string;
  album: string | null;
  artwork_url: string | null;
  preview_url: string | null;
  external_url: string | null;
  duration_ms: number | null;
}

/** Thrown when search fails for any reason other than the caller aborting it. */
export class SearchUnavailableError extends Error {
  /**
   * @param options - The underlying failure, kept as `cause`.
   */
  constructor(options?: { cause?: unknown }) {
    super('Song search is unavailable right now.', options);
    this.name = 'SearchUnavailableError';
  }
}

export interface SearchOptions {
  /** Aborts the request (e.g. when the term changes); the abort error is rethrown as-is. */
  signal?: AbortSignal;
}

/** Searches songs by free text. */
export type SongSearch = (term: string, options?: SearchOptions) => Promise<SongResult[]>;

const SEARCH_ENDPOINT = 'https://itunes.apple.com/search';
const RESULT_LIMIT = 12;
/** Upper bound for one search, retries included. */
export const SEARCH_TIMEOUT_MS = 8000;
const REGION = /^[A-Z]{2}$/;
const ARTWORK_HOSTS = ['mzstatic.com'];
const PREVIEW_HOSTS = ['itunes.apple.com', 'mzstatic.com'];
const MAX_DURATION_MS = 86_400_000;
/** The API's length limit for every URL field. */
const MAX_URL_LENGTH = 1000;

/**
 * Derives the iTunes `country` parameter from a BCP 47 language tag.
 *
 * @param language - E.g. `navigator.language`.
 * @returns The two-letter region (`"en-CA"` → `"CA"`), or `null` when the tag has no
 *   two-letter region (`"en"`, `"es-419"`) or is invalid.
 */
export function regionFromLanguage(language: string): string | null {
  try {
    const { region } = new Intl.Locale(language);
    return region !== undefined && REGION.test(region) ? region : null;
  } catch {
    return null;
  }
}

/**
 * Builds a search request URL.
 *
 * @param term - The search text.
 * @param country - A two-letter region, or `null` to omit the parameter.
 * @returns The full iTunes Search API URL.
 */
export function buildSearchUrl(term: string, country: string | null): string {
  const params = new URLSearchParams({
    media: 'music',
    entity: 'song',
    limit: String(RESULT_LIMIT),
    term,
  });
  if (country !== null) {
    params.set('country', country);
  }
  return `${SEARCH_ENDPOINT}?${params.toString()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function parseUrl(value: string | null, protocols: readonly string[]): URL | null {
  if (value === null || value.length > MAX_URL_LENGTH || !URL.canParse(value)) {
    return null;
  }
  const url = new URL(value);
  return protocols.includes(url.protocol) && url.hostname !== '' ? url : null;
}

function hostAllowed(hostname: string, allowed: readonly string[]): boolean {
  return allowed.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function allowedHttpsUrl(value: string | null, hosts: readonly string[]): string | null {
  const url = parseUrl(value, ['https:']);
  return url !== null && hostAllowed(url.hostname, hosts) ? value : null;
}

function readDuration(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_DURATION_MS
    ? value
    : null;
}

/**
 * Maps one raw iTunes result to a {@link SongResult}.
 *
 * Artwork is upscaled from 100×100 to 600×600. Artwork and preview URLs must be `https` on
 * Apple's CDN hosts and the store link must be `http(s)`, each at most 1000 characters;
 * otherwise they become `null`.
 *
 * @param raw - One element of the API's `results` array.
 * @returns The mapped song, or `null` when the track id, title or artist is missing.
 */
export function mapItunesResult(raw: unknown): SongResult | null {
  if (!isRecord(raw)) {
    return null;
  }
  const { trackId } = raw;
  const title = readString(raw, 'trackName');
  const artist = readString(raw, 'artistName');
  if (typeof trackId !== 'number' || !Number.isSafeInteger(trackId) || !title || !artist) {
    return null;
  }
  const artwork = readString(raw, 'artworkUrl100')?.replace('/100x100bb.', '/600x600bb.') ?? null;
  const externalUrl = readString(raw, 'trackViewUrl');
  return {
    source: 'itunes',
    source_id: String(trackId),
    title,
    artist,
    album: readString(raw, 'collectionName'),
    artwork_url: allowedHttpsUrl(artwork, ARTWORK_HOSTS),
    preview_url: allowedHttpsUrl(readString(raw, 'previewUrl'), PREVIEW_HOSTS),
    external_url: parseUrl(externalUrl, ['https:', 'http:']) === null ? null : externalUrl,
    duration_ms: readDuration(raw.trackTimeMillis),
  };
}

function parseResults(body: unknown): SongResult[] {
  if (!isRecord(body) || !Array.isArray(body.results)) {
    throw new SearchUnavailableError({ cause: new TypeError('Malformed search response') });
  }
  const results: unknown[] = body.results;
  return results.map(mapItunesResult).filter((song) => song !== null);
}

/**
 * Creates a search function with its own session state.
 *
 * The `country` parameter comes from the browser language. If Apple rejects a request that
 * carries it (HTTP 400), the search retries once without it and omits it for the rest of the
 * session.
 *
 * @param getLanguage - Reads the browser language (defaults to `navigator.language`).
 * @returns The search function.
 */
export function createSongSearch(getLanguage: () => string = () => navigator.language): SongSearch {
  let countryEnabled = true;

  return async function search(term, { signal } = {}) {
    const query = term.trim();
    if (query === '') {
      return [];
    }
    const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
    const requestSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    const country = countryEnabled ? regionFromLanguage(getLanguage()) : null;
    try {
      let response = await fetch(buildSearchUrl(query, country), { signal: requestSignal });
      if (response.status === 400 && country !== null) {
        countryEnabled = false;
        response = await fetch(buildSearchUrl(query, null), { signal: requestSignal });
      }
      if (!response.ok) {
        throw new SearchUnavailableError({
          cause: new Error(`HTTP ${String(response.status)}`),
        });
      }
      return parseResults(await response.json());
    } catch (error) {
      if (signal?.aborted || error instanceof SearchUnavailableError) {
        throw error;
      }
      throw new SearchUnavailableError({ cause: error });
    }
  };
}

/** Searches songs with session-wide country handling (see {@link createSongSearch}). */
export const searchSongs: SongSearch = createSongSearch();
