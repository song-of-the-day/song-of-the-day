import { expect, test } from './fixtures';

/** Asserts the nginx security headers on an HTML or asset response. */
function expectSecurityHeaders(headers: Record<string, string>, where: string): void {
  expect(headers['content-security-policy'], `${where}: CSP`).toContain("default-src 'self'");
  expect(headers['x-content-type-options'], `${where}: nosniff`).toBe('nosniff');
  expect(headers['x-robots-tag'], `${where}: robots`).toBe('noindex, nofollow');
  expect(headers['referrer-policy'], `${where}: referrer`).toBe('strict-origin-when-cross-origin');
  expect(headers['strict-transport-security'], `${where}: HSTS`).toContain('max-age=31536000');
  expect(headers['permissions-policy'], `${where}: permissions`).toContain('camera=()');
}

test('HTML pages, hashed assets and 404s carry the security headers', async ({ page }) => {
  const home = await page.request.get('/');
  expect(home.status()).toBe(200);
  expectSecurityHeaders(home.headers(), 'GET /');

  const profile = await page.request.get('/profile');
  expect(profile.status()).toBe(200);
  expectSecurityHeaders(profile.headers(), 'GET /profile');

  const html = await home.text();
  const asset = /\/assets\/[^"]+\.js/.exec(html)?.[0];
  expect(asset, 'hashed script in index.html').toBeTruthy();
  const assetResponse = await page.request.get(asset ?? '/assets/missing.js');
  expect(assetResponse.status()).toBe(200);
  expectSecurityHeaders(assetResponse.headers(), `GET ${String(asset)}`);

  const missing = await page.request.get('/assets/does-not-exist-9f3a.js');
  expect(missing.status()).toBe(404);
  expectSecurityHeaders(missing.headers(), 'GET missing asset');
});

test('JSON API responses are non-cacheable and framed-deny', async ({ page }) => {
  const health = await page.request.get('/api/health');
  expect(health.status()).toBe(200);
  const headers = health.headers();
  expect(headers['cache-control']).toBe('no-store');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
});
