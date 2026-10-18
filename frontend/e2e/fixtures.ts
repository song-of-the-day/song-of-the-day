import { expect, test as base, type BrowserContext, type Page, type Route } from '@playwright/test';

import { CATALOG, PNG_1X1, WAV_SILENCE, YOUTUBE_EMBED_HTML, YOUTUBE_IFRAME_API } from './stubs';

/** Prefix of the console message the init script logs for each CSP violation. */
const CSP_VIOLATION_MARKER = '[sotd:csp-violation]';

function searchResponse(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const term = (url.searchParams.get('term') ?? '').trim().toLowerCase();
  const limit = Number(url.searchParams.get('limit') ?? '50');
  const words = term.split(/\s+/).filter(Boolean);
  const results = CATALOG.filter((song) => {
    const haystack = `${song.trackName} ${song.artistName} ${song.collectionName}`.toLowerCase();
    return words.length > 0 && words.every((word) => haystack.includes(word));
  }).slice(0, limit);
  // Apple serves JSON as text/javascript; the client must parse it regardless.
  return route.fulfill({
    status: 200,
    contentType: 'text/javascript; charset=utf-8',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ resultCount: results.length, results }),
  });
}

/**
 * Routes every third-party request to local fixtures: iTunes search, Apple
 * artwork and previews, the YouTube IFrame API and the youtube-nocookie embed. Anything else that
 * leaves the app's origin (`baseURL`) is aborted and fails the test, so specs never touch the internet.
 */
async function installNetworkStubs(
  context: BrowserContext,
  appOrigin: string,
  unexpected: string[],
): Promise<void> {
  // Routes registered later take precedence, so the catch-all goes first.
  await context.route(
    (url) => url.origin !== appOrigin,
    (route) => {
      unexpected.push(`${route.request().method()} ${route.request().url()}`);
      return route.abort('blockedbyclient');
    },
  );
  await context.route('https://itunes.apple.com/search**', searchResponse);
  await context.route('https://*.mzstatic.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }),
  );
  await context.route('https://audio-ssl.itunes.apple.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: WAV_SILENCE }),
  );
  await context.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: YOUTUBE_IFRAME_API,
    }),
  );
  await context.route('https://www.youtube-nocookie.com/embed/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: YOUTUBE_EMBED_HTML,
    }),
  );
}

/**
 * Installs the third-party stubs on an extra context a spec creates itself (e.g. a logged-out
 * visitor in a fresh browser context). Returns the list of requests that would have left the
 * machine; assert it is empty at the end of the test.
 *
 * @param context - The extra browser context (before it navigates anywhere).
 * @param appOrigin - The app's origin, e.g. `http://localhost:8080`.
 * @returns The collected unexpected external requests.
 */
export async function stubExternalRequests(
  context: BrowserContext,
  appOrigin: string,
): Promise<string[]> {
  const unexpected: string[] = [];
  await installNetworkStubs(context, appOrigin, unexpected);
  return unexpected;
}

/** The page script that reports every CSP violation on the console. */
function reportCspViolations(marker: string): void {
  document.addEventListener('securitypolicyviolation', (event) => {
    console.error(`${marker} ${event.violatedDirective} ${event.blockedURI}`);
  });
}

/**
 * Watches one page for CSP violations (call before its first navigation). Returns the growing
 * list; assert it is empty at the end of the test.
 *
 * @param page - The page to watch.
 * @returns The collected violations, prefixed with the violated directive.
 */
export async function watchCspViolations(page: Page): Promise<string[]> {
  const violations: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (text.startsWith(CSP_VIOLATION_MARKER)) {
      violations.push(text.slice(CSP_VIOLATION_MARKER.length).trim());
    }
  });
  await page.addInitScript(reportCspViolations, CSP_VIOLATION_MARKER);
  return violations;
}

interface Fixtures {
  cspViolations: string[];
  externalRequests: string[];
}

/**
 * Playwright `test` with two automatic fixtures:
 * - `externalRequests` stubs all third-party traffic and fails the test on any unstubbed request;
 * - `cspViolations` fails the test when the page reports any `securitypolicyviolation` event.
 *
 * Specs import `test` and `expect` from here.
 */
export const test = base.extend<Fixtures>({
  externalRequests: [
    async ({ context, baseURL }, use) => {
      const unexpected = await stubExternalRequests(
        context,
        new URL(baseURL ?? 'http://localhost').origin,
      );
      await use(unexpected);
      expect(unexpected, 'requests that would have left the machine').toEqual([]);
    },
    { auto: true },
  ],
  cspViolations: [
    async ({ page }, use) => {
      const violations = await watchCspViolations(page);
      await use(violations);
      expect(violations, 'Content-Security-Policy violations').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
