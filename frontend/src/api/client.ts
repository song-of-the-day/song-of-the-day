/**
 * `fetch` wrapper for the same-origin API.
 *
 * - Sends same-origin credentials and JSON (or `FormData` for uploads).
 * - Caches the CSRF token from `GET /api/auth/csrf` and attaches it to unsafe methods; on
 *   `403 csrf_failed` it refreshes the token and retries once.
 * - Throws {@link ApiError} for every failure. Responses that are not API errors (nginx pages,
 *   network failures) become `payload_too_large`, `internal_error` or `network_error`.
 * - Notifies {@link onUnauthorized} listeners on `401 unauthorized`.
 */
import { ApiError } from './errors';

export const API_BASE = '/api';
const CSRF_HEADER = 'X-CSRFToken';
const UNSAFE_METHODS: ReadonlySet<HttpMethod> = new Set(['POST', 'PATCH', 'DELETE']);

const MESSAGES = {
  network: "Couldn't reach the server. Check your connection and try again.",
  payloadTooLarge: 'File is too large.',
  internal: 'Something went wrong. Please try again.',
} as const;

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Query string values; `undefined` values are left out. */
export type QueryParams = Record<string, string | number | undefined>;

export interface RequestOptions {
  method?: HttpMethod;
  /** A JSON-serializable body, or `FormData` for multipart uploads. */
  body?: unknown;
  query?: QueryParams;
  signal?: AbortSignal;
  /**
   * The call rotates the session (login, signup, logout, account deletion), so the cached CSRF
   * token is dropped once it completes.
   */
  rotatesCsrfToken?: boolean;
  /** Skip the unauthorized listeners on 401 (for `GET /auth/me`, where 401 means logged out). */
  ignoreUnauthorized?: boolean;
}

let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;
let csrfGeneration = 0;
const unauthorizedListeners = new Set<() => void>();

/** Forgets the cached CSRF token; the next unsafe request fetches a fresh one. */
export function clearCsrfToken(): void {
  csrfGeneration += 1;
  csrfToken = null;
  csrfRequest = null;
}

/**
 * Subscribes to `401 unauthorized` responses (the session ended), e.g. to clear `['me']`.
 *
 * @param listener - Called once per unauthorized response.
 * @returns A function that unsubscribes the listener.
 */
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

/**
 * Builds an API URL.
 *
 * @param path - The path below `/api`, starting with `/`.
 * @param query - Query parameters; `undefined` values are skipped.
 * @returns The same-origin URL.
 */
export function apiUrl(path: string, query: QueryParams = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return `${API_BASE}${path}${search === '' ? '' : `?${search}`}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

type ParsedBody = { ok: true; value: unknown } | { ok: false };

async function parseJson(response: Response): Promise<ParsedBody> {
  try {
    const value: unknown = JSON.parse(await response.text());
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

function fallbackError(status: number): ApiError {
  return status === 413
    ? new ApiError({ status, code: 'payload_too_large', message: MESSAGES.payloadTooLarge })
    : new ApiError({ status, code: 'internal_error', message: MESSAGES.internal });
}

/** Reads a delay-seconds `Retry-After` header (the form Flask-Limiter sends). */
function parseRetryAfter(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) {
    return null;
  }
  return Number(value.trim());
}

async function readError(response: Response): Promise<ApiError> {
  const parsed = await parseJson(response);
  const error = parsed.ok && isRecord(parsed.value) ? parsed.value.error : undefined;
  if (!isRecord(error) || typeof error.code !== 'string') {
    return fallbackError(response.status);
  }
  const { code, message, fields, ...details } = error;
  const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
  return new ApiError({
    status: response.status,
    code,
    message: typeof message === 'string' ? message : MESSAGES.internal,
    fields: isStringRecord(fields) ? fields : {},
    details: retryAfter === null ? details : { ...details, retry_after_seconds: retryAfter },
  });
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, credentials: 'same-origin' });
  } catch (error) {
    if (init.signal?.aborted) {
      throw error;
    }
    throw new ApiError({ status: 0, code: 'network_error', message: MESSAGES.network });
  }
}

async function fetchCsrfToken(): Promise<string> {
  const generation = csrfGeneration;
  const response = await send(apiUrl('/auth/csrf'), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw await readError(response);
  }
  const parsed = await parseJson(response);
  const token = parsed.ok && isRecord(parsed.value) ? parsed.value.csrf_token : undefined;
  if (typeof token !== 'string' || token === '') {
    throw fallbackError(response.status);
  }
  if (generation === csrfGeneration) {
    csrfToken = token;
  }
  return token;
}

async function getCsrfToken(): Promise<string> {
  if (csrfToken !== null) {
    return csrfToken;
  }
  if (csrfRequest === null) {
    const request = fetchCsrfToken().finally(() => {
      // A cleared cache may already have started a newer request; leave that one shared.
      if (csrfRequest === request) {
        csrfRequest = null;
      }
    });
    csrfRequest = request;
  }
  return csrfRequest;
}

async function attempt(
  url: string,
  method: HttpMethod,
  options: RequestOptions,
): Promise<Response> {
  const headers = new Headers({ Accept: 'application/json' });
  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }
  if (UNSAFE_METHODS.has(method)) {
    headers.set(CSRF_HEADER, await getCsrfToken());
  }
  return send(url, { method, headers, body, signal: options.signal });
}

/**
 * Sends an API request and returns the successful response unread.
 *
 * @param path - The path below `/api`, starting with `/`.
 * @param options - Method, body, query, abort signal and session flags.
 * @returns The 2xx response.
 * @throws ApiError for any non-2xx response or network failure. An abort of `options.signal`
 *   rethrows the abort error unchanged.
 */
export async function apiResponse(path: string, options: RequestOptions = {}): Promise<Response> {
  const method = options.method ?? 'GET';
  const url = apiUrl(path, options.query);
  try {
    let response = await attempt(url, method, options);
    if (!response.ok && UNSAFE_METHODS.has(method) && response.status === 403) {
      const error = await readError(response.clone());
      if (error.code === 'csrf_failed') {
        clearCsrfToken();
        response = await attempt(url, method, options);
      }
    }
    if (response.ok) {
      return response;
    }
    const error = await readError(response);
    if (error.status === 401 && error.code === 'unauthorized' && !options.ignoreUnauthorized) {
      for (const listener of unauthorizedListeners) {
        listener();
      }
    }
    throw error;
  } finally {
    if (options.rotatesCsrfToken) {
      clearCsrfToken();
    }
  }
}

/**
 * Sends an API request that answers with a JSON body.
 *
 * @param path - The path below `/api`, starting with `/`.
 * @param options - See {@link apiResponse}.
 * @returns The parsed body; callers assert its documented shape.
 * @throws ApiError as {@link apiResponse} does, or `internal_error` when the body isn't JSON.
 */
export async function apiJson(path: string, options: RequestOptions = {}): Promise<unknown> {
  const response = await apiResponse(path, options);
  const parsed = await parseJson(response);
  if (!parsed.ok) {
    throw fallbackError(response.status);
  }
  return parsed.value;
}

/**
 * Sends an API request whose response body is irrelevant (`202 {}` or `204`).
 *
 * @param path - The path below `/api`, starting with `/`.
 * @param options - See {@link apiResponse}.
 * @throws ApiError as {@link apiResponse} does.
 */
export async function apiVoid(path: string, options: RequestOptions = {}): Promise<void> {
  await apiResponse(path, options);
}
