import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiErrorResponse, fakeApi } from '@/test/fakeApi';
import { server } from '@/test/server';

import { apiJson, apiResponse, apiUrl, apiVoid, clearCsrfToken, onUnauthorized } from './client';
import { ApiError } from './errors';

function csrfRequests(): number {
  return fakeApi.requests.filter((request) => request.path === '/api/auth/csrf').length;
}

describe('apiUrl', () => {
  it('prefixes /api and skips undefined query values', () => {
    expect(apiUrl('/entries')).toBe('/api/entries');
    expect(apiUrl('/entries', { start: '2026-10-01', before: undefined, limit: 31 })).toBe(
      '/api/entries?start=2026-10-01&limit=31',
    );
  });
});

describe('apiJson', () => {
  it('parses a JSON response from a same-origin GET', async () => {
    const user = fakeApi.seedUser({ display_name: 'Grace' });
    fakeApi.signIn(user.id);

    await expect(apiJson('/auth/me')).resolves.toEqual({ user });
  });

  it('sends JSON bodies with a content type and the CSRF token', async () => {
    let seen: { contentType: string | null; csrf: string | null; body: unknown } | null = null;
    server.use(
      http.post('/api/echo', async ({ request }) => {
        seen = {
          contentType: request.headers.get('Content-Type'),
          csrf: request.headers.get('X-CSRFToken'),
          body: await request.json(),
        };
        return HttpResponse.json({ ok: true });
      }),
    );

    await expect(apiJson('/echo', { method: 'POST', body: { a: 1 } })).resolves.toEqual({
      ok: true,
    });
    expect(seen).toEqual({
      contentType: 'application/json',
      csrf: fakeApi.csrfToken,
      body: { a: 1 },
    });
  });

  it('throws internal_error when a successful response is not JSON', async () => {
    server.use(http.get('/api/html', () => HttpResponse.text('<!doctype html>')));

    await expect(apiJson('/html')).rejects.toMatchObject({ status: 200, code: 'internal_error' });
  });
});

describe('CSRF handling', () => {
  it('fetches the token once and reuses it for later unsafe requests', async () => {
    const user = fakeApi.seedUser();
    fakeApi.signIn(user.id);

    await apiJson('/profile', { method: 'PATCH', body: { bio: 'one' } });
    await apiJson('/profile', { method: 'PATCH', body: { bio: 'two' } });

    expect(csrfRequests()).toBe(1);
  });

  it('shares one token request between concurrent unsafe requests', async () => {
    const user = fakeApi.seedUser();
    fakeApi.signIn(user.id);

    await Promise.all([
      apiJson('/profile', { method: 'PATCH', body: { bio: 'a' } }),
      apiJson('/profile', { method: 'PATCH', body: { bio: 'b' } }),
    ]);

    expect(csrfRequests()).toBe(1);
  });

  it('does not send a token on safe requests', async () => {
    await apiVoid('/auth/me', { ignoreUnauthorized: true }).catch(() => undefined);

    expect(csrfRequests()).toBe(0);
    expect(fakeApi.requests[0]?.csrfToken).toBeNull();
  });

  it('refreshes the token and retries once on csrf_failed', async () => {
    const user = fakeApi.seedUser();
    fakeApi.signIn(user.id);
    await apiJson('/profile', { method: 'PATCH', body: { bio: 'warm up' } });
    // The session rotates behind the client's back (e.g. a login in another tab).
    fakeApi.signIn(user.id);

    await expect(
      apiJson('/profile', { method: 'PATCH', body: { bio: 'after rotation' } }),
    ).resolves.toMatchObject({ user: { bio: 'after rotation' } });
    expect(csrfRequests()).toBe(2);
  });

  it('gives up after one retry', async () => {
    server.use(
      http.post('/api/always-csrf', () =>
        apiErrorResponse(403, 'csrf_failed', 'The CSRF token is missing or invalid.'),
      ),
    );

    await expect(apiVoid('/always-csrf', { method: 'POST' })).rejects.toMatchObject({
      status: 403,
      code: 'csrf_failed',
    });
    expect(fakeApi.requests.filter((request) => request.path === '/api/always-csrf')).toHaveLength(
      2,
    );
  });

  it('does not retry other 403 errors', async () => {
    server.use(http.post('/api/forbidden', () => apiErrorResponse(403, 'forbidden', 'Nope.')));

    await expect(apiVoid('/forbidden', { method: 'POST' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(fakeApi.requests.filter((request) => request.path === '/api/forbidden')).toHaveLength(1);
  });

  it('drops the cached token after a call that rotates the session', async () => {
    const user = fakeApi.seedUser();
    await apiJson('/auth/login', {
      method: 'POST',
      body: { email: user.email, password: 'correct horse battery' },
      rotatesCsrfToken: true,
    });

    await apiJson('/profile', { method: 'PATCH', body: { bio: 'fresh token' } });

    expect(csrfRequests()).toBe(2);
    expect(fakeApi.requests.filter((request) => request.path === '/api/profile')).toHaveLength(1);
  });

  it('drops the cached token even when the rotating call fails', async () => {
    await expect(
      apiJson('/auth/login', {
        method: 'POST',
        body: { email: 'nobody@example.com', password: 'wrong password' },
        rotatesCsrfToken: true,
      }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    await apiVoid('/auth/logout', { method: 'POST' });

    expect(csrfRequests()).toBe(2);
  });

  it('does not cache a token that arrives after the cache was cleared', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let csrfCalls = 0;
    const sent: (string | null)[] = [];
    server.use(
      http.get('/api/auth/csrf', async () => {
        csrfCalls += 1;
        if (csrfCalls === 1) {
          await gate;
          return HttpResponse.json({ csrf_token: 'stale' });
        }
        return HttpResponse.json({ csrf_token: 'fresh' });
      }),
      http.post('/api/echo', ({ request }) => {
        sent.push(request.headers.get('X-CSRFToken'));
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const first = apiVoid('/echo', { method: 'POST' });
    clearCsrfToken();
    release();
    await first;
    await apiVoid('/echo', { method: 'POST' });

    expect(sent).toEqual(['stale', 'fresh']);
  });

  it('keeps sharing a newer token request when an older one settles', async () => {
    const gates: (() => void)[] = [];
    const tokens = ['stale', 'fresh', 'extra'];
    let csrfCalls = 0;
    const sent: (string | null)[] = [];
    server.use(
      http.get('/api/auth/csrf', async () => {
        const token = tokens[csrfCalls] ?? 'unexpected';
        csrfCalls += 1;
        if (token !== 'extra') {
          await new Promise<void>((resolve) => {
            gates.push(resolve);
          });
        }
        return HttpResponse.json({ csrf_token: token });
      }),
      http.post('/api/echo', ({ request }) => {
        sent.push(request.headers.get('X-CSRFToken'));
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const first = apiVoid('/echo', { method: 'POST' });
    clearCsrfToken();
    const second = apiVoid('/echo', { method: 'POST' });
    await vi.waitFor(() => {
      expect(gates).toHaveLength(2);
    });
    gates[0]?.();
    await first;
    const third = apiVoid('/echo', { method: 'POST' });
    gates[1]?.();
    await Promise.all([second, third]);

    expect(csrfCalls).toBe(2);
    expect(sent).toEqual(['stale', 'fresh', 'fresh']);
  });

  it.each([
    ['JSON without csrf_token', () => HttpResponse.json({ token: 'wrong key' })],
    ['an empty token', () => HttpResponse.json({ csrf_token: '' })],
    ['an HTML page', () => HttpResponse.html('<!doctype html><title>song of the day</title>')],
  ])('turns a token response with %s into internal_error', async (_label, respond) => {
    server.use(http.get('/api/auth/csrf', respond));

    await expect(apiVoid('/auth/logout', { method: 'POST' })).rejects.toMatchObject({
      code: 'internal_error',
    });
  });

  it('surfaces a failed token request as its API error', async () => {
    server.use(
      http.get('/api/auth/csrf', () => apiErrorResponse(503, 'service_unavailable', 'Down.')),
    );

    await expect(apiVoid('/auth/logout', { method: 'POST' })).rejects.toMatchObject({
      status: 503,
      code: 'service_unavailable',
    });
  });
});

describe('errors', () => {
  it('maps an API error body to ApiError with fields and details', async () => {
    server.use(
      http.post('/api/entries', () =>
        apiErrorResponse(409, 'entry_exists', 'Already logged.', {
          existing_entry_id: 42,
          request_id: 'abc',
        }),
      ),
      http.patch('/api/profile', () =>
        apiErrorResponse(422, 'validation_error', 'Some fields are invalid.', {
          fields: { display_name: 'Too long.' },
        }),
      ),
    );

    const conflict = await apiJson('/entries', { method: 'POST', body: {} }).catch(
      (error: unknown) => error,
    );
    expect(conflict).toBeInstanceOf(ApiError);
    expect(conflict).toMatchObject({
      status: 409,
      code: 'entry_exists',
      message: 'Already logged.',
      fields: {},
      details: { existing_entry_id: 42, request_id: 'abc' },
    });

    await expect(apiJson('/profile', { method: 'PATCH', body: {} })).rejects.toMatchObject({
      code: 'validation_error',
      fields: { display_name: 'Too long.' },
    });
  });

  it.each([
    ['an nginx 413 page', 413, '<html>413</html>', 'payload_too_large', 'File is too large.'],
    ['an nginx 502 page', 502, '<html>Bad Gateway</html>', 'internal_error', undefined],
    ['a 504 with an empty body', 504, '', 'internal_error', undefined],
    ['JSON without error.code', 500, '{"error":{"message":"x"}}', 'internal_error', undefined],
    ['a JSON array', 500, '[1,2]', 'internal_error', undefined],
  ])('maps %s to %s', async (_label, status, body, code, message) => {
    server.use(http.get('/api/broken', () => new HttpResponse(body, { status })));

    await expect(apiJson('/broken')).rejects.toMatchObject({
      status,
      code,
      ...(message === undefined ? {} : { message }),
    });
  });

  it('uses a generic message when the error body has no message', async () => {
    server.use(
      http.get('/api/terse', () => HttpResponse.json({ error: { code: 'x' } }, { status: 400 })),
    );

    await expect(apiJson('/terse')).rejects.toMatchObject({
      code: 'x',
      message: 'Something went wrong. Please try again.',
    });
  });

  it('adds a delay-seconds Retry-After header to the details', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          { error: { code: 'rate_limited', message: 'Slow down.' } },
          { status: 429, headers: { 'Retry-After': ' 120 ' } },
        ),
      ),
    );

    await expect(apiJson('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'rate_limited',
      details: { retry_after_seconds: 120 },
    });
  });

  it('ignores a Retry-After header that is not a number of seconds', async () => {
    server.use(
      http.get('/api/limited', () =>
        HttpResponse.json(
          { error: { code: 'rate_limited', message: 'Slow down.' } },
          { status: 429, headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' } },
        ),
      ),
    );

    const error: unknown = await apiJson('/limited').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).details).toEqual({});
  });

  it('ignores malformed field errors', async () => {
    server.use(
      http.get('/api/odd', () =>
        HttpResponse.json(
          { error: { code: 'validation_error', message: 'Bad.', fields: { a: 1 } } },
          { status: 422 },
        ),
      ),
    );

    await expect(apiJson('/odd')).rejects.toMatchObject({ fields: {} });
  });

  it('maps a network failure to network_error with status 0', async () => {
    server.use(http.get('/api/offline', () => HttpResponse.error()));

    await expect(apiJson('/offline')).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });
  });

  it('rethrows an abort of the caller signal unchanged', async () => {
    server.use(
      http.get('/api/slow', async ({ request }) => {
        await new Promise((resolve) => {
          request.signal.addEventListener('abort', resolve);
        });
        return HttpResponse.json({});
      }),
    );
    const controller = new AbortController();
    const request = apiJson('/slow', { signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('responses', () => {
  it('returns the raw response for downloads', async () => {
    server.use(http.get('/api/file', () => HttpResponse.text('hello')));

    const response = await apiResponse('/file');

    await expect(response.text()).resolves.toBe('hello');
  });

  it('resolves apiVoid for 204 and 202 responses', async () => {
    fakeApi.seedUser({ email: 'ada@example.com' });

    await expect(apiVoid('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
    await expect(
      apiVoid('/auth/password-reset/request', {
        method: 'POST',
        body: { email: 'ada@example.com' },
      }),
    ).resolves.toBeUndefined();
  });

  it('sends FormData without a JSON content type', async () => {
    let contentType: string | null = null;
    server.use(
      http.post('/api/form', ({ request }) => {
        contentType = request.headers.get('Content-Type');
        return HttpResponse.json({});
      }),
    );
    const form = new FormData();
    form.append('file', new Blob(['x'], { type: 'image/png' }), 'x.png');

    await apiJson('/form', { method: 'POST', body: form });

    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
  });

  it('sends unsafe requests without a body and without a content type', async () => {
    let contentType: string | null = 'unset';
    server.use(
      http.delete('/api/thing', ({ request }) => {
        contentType = request.headers.get('Content-Type');
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await apiVoid('/thing', { method: 'DELETE' });

    expect(contentType).toBeNull();
  });
});

describe('onUnauthorized', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('notifies listeners on 401 unauthorized', async () => {
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);

    await expect(apiJson('/entries')).rejects.toMatchObject({ code: 'unauthorized' });
    unsubscribe();
    await expect(apiJson('/entries')).rejects.toMatchObject({ code: 'unauthorized' });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify for /auth/me or invalid_credentials', async () => {
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);
    const user = fakeApi.seedUser();

    await expect(apiJson('/auth/me', { ignoreUnauthorized: true })).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      apiJson('/auth/login', {
        method: 'POST',
        body: { email: user.email, password: 'not the password' },
      }),
    ).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
    unsubscribe();

    expect(listener).not.toHaveBeenCalled();
  });
});
