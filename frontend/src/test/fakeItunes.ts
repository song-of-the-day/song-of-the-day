/**
 * A fake of the iTunes Search API that searches {@link ITUNES_CATALOG}, answering with
 * `text/javascript` like Apple does. Override it per test with `server.use(...)`.
 */
import { http, HttpResponse } from 'msw';

import { ITUNES_CATALOG, makeItunesResponse } from './fixtures';

export const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';

/**
 * Builds a search response with Apple's content type.
 *
 * @param body - The JSON body.
 * @param status - HTTP status.
 */
export function itunesResponse(body: unknown, status = 200) {
  return new HttpResponse(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
  });
}

export const itunesHandlers = [
  http.get(ITUNES_SEARCH_URL, ({ request }) => {
    const params = new URL(request.url).searchParams;
    const term = (params.get('term') ?? '').toLowerCase();
    const limit = Number(params.get('limit') ?? '50');
    const results = ITUNES_CATALOG.filter((track) =>
      [track.trackName, track.artistName, track.collectionName ?? ''].some((field) =>
        field.toLowerCase().includes(term),
      ),
    ).slice(0, limit);
    return itunesResponse(makeItunesResponse(results));
  }),
];
