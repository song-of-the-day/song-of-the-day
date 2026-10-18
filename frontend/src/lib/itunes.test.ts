import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { makeItunesResponse, makeItunesTrack } from '@/test/fixtures';
import { ITUNES_SEARCH_URL, itunesResponse } from '@/test/fakeItunes';
import { server } from '@/test/server';

import {
  buildSearchUrl,
  createSongSearch,
  mapItunesResult,
  regionFromLanguage,
  SEARCH_TIMEOUT_MS,
  SearchUnavailableError,
  searchSongs,
} from './itunes';

/** Serves `tracks` and records every requested URL. */
function serve(tracks: unknown[] = [makeItunesTrack()]): URL[] {
  const seen: URL[] = [];
  server.use(
    http.get(ITUNES_SEARCH_URL, ({ request }) => {
      seen.push(new URL(request.url));
      return itunesResponse(makeItunesResponse(tracks));
    }),
  );
  return seen;
}

describe('regionFromLanguage', () => {
  it.each([
    ['en-CA', 'CA'],
    ['fr-ca', 'CA'],
    ['zh-Hant-TW', 'TW'],
    ['en', null],
    ['es-419', null],
    ['not a tag!', null],
    ['', null],
  ])('%j → %j', (language, region) => {
    expect(regionFromLanguage(language)).toBe(region);
  });
});

describe('buildSearchUrl', () => {
  it('builds the documented query, with or without country', () => {
    expect(buildSearchUrl('jamie xx', 'CA')).toBe(
      'https://itunes.apple.com/search?media=music&entity=song&limit=12&term=jamie+xx&country=CA',
    );
    expect(buildSearchUrl('a&b', null)).toBe(
      'https://itunes.apple.com/search?media=music&entity=song&limit=12&term=a%26b',
    );
  });
});

describe('mapItunesResult', () => {
  it('maps a track to the entry payload shape, upscaling artwork', () => {
    expect(mapItunesResult(makeItunesTrack())).toEqual({
      source: 'itunes',
      source_id: '1525506452',
      title: 'Gosh',
      artist: 'Jamie xx',
      album: 'In Colour',
      artwork_url: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/b9/dc/ce/600x600bb.jpg',
      preview_url:
        'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/mzaf_674086647576238926.plus.aac.p.m4a',
      external_url: 'https://music.apple.com/us/album/gosh/1525506447?i=1525506452&uo=4',
      duration_ms: 290973,
    });
  });

  it('turns missing optional fields into null and trims text', () => {
    expect(
      mapItunesResult({
        trackId: 7,
        trackName: '  Song  ',
        artistName: 'Artist',
        collectionName: ' ',
      }),
    ).toEqual({
      source: 'itunes',
      source_id: '7',
      title: 'Song',
      artist: 'Artist',
      album: null,
      artwork_url: null,
      preview_url: null,
      external_url: null,
      duration_ms: null,
    });
  });

  it.each([
    ['a non-object', 'track'],
    ['null', null],
    ['no trackId', { trackName: 'a', artistName: 'b' }],
    ['a string trackId', { trackId: '1', trackName: 'a', artistName: 'b' }],
    ['a fractional trackId', { trackId: 1.5, trackName: 'a', artistName: 'b' }],
    ['no title', { trackId: 1, artistName: 'b' }],
    ['a blank artist', { trackId: 1, trackName: 'a', artistName: '   ' }],
  ])('skips %s', (_label, raw) => {
    expect(mapItunesResult(raw)).toBeNull();
  });

  it('drops URLs the API would reject', () => {
    const song = mapItunesResult(
      makeItunesTrack({
        artworkUrl100: 'http://is1-ssl.mzstatic.com/a/100x100bb.jpg',
        previewUrl: 'https://evil.example.com/preview.m4a',
        trackViewUrl: 'javascript:alert(1)',
      }),
    );

    expect(song).toMatchObject({ artwork_url: null, preview_url: null, external_url: null });
  });

  it('accepts exact allowlisted hosts and http store links', () => {
    const song = mapItunesResult(
      makeItunesTrack({
        artworkUrl100: 'https://mzstatic.com/a/100x100bb.jpg',
        previewUrl: 'https://itunes.apple.com/p.m4a',
        trackViewUrl: 'http://music.apple.com/song/1',
      }),
    );

    expect(song).toMatchObject({
      artwork_url: 'https://mzstatic.com/a/600x600bb.jpg',
      preview_url: 'https://itunes.apple.com/p.m4a',
      external_url: 'http://music.apple.com/song/1',
    });
  });

  it('drops URLs longer than the API accepts', () => {
    const padding = 'a'.repeat(1000);
    const song = mapItunesResult(
      makeItunesTrack({
        artworkUrl100: `https://is1-ssl.mzstatic.com/${padding}/100x100bb.jpg`,
        previewUrl: `https://audio-ssl.itunes.apple.com/${padding}.m4a`,
        trackViewUrl: `https://music.apple.com/${padding}`,
      }),
    );

    expect(song).toMatchObject({ artwork_url: null, preview_url: null, external_url: null });
  });

  it('rejects look-alike hosts and unparsable URLs', () => {
    const song = mapItunesResult(
      makeItunesTrack({ artworkUrl100: 'https://notmzstatic.com/a.jpg', previewUrl: 'not a url' }),
    );

    expect(song).toMatchObject({ artwork_url: null, preview_url: null });
  });

  it.each([0, -5, 1.5, 86_400_001, Number.NaN])('drops the invalid duration %s', (duration) => {
    expect(mapItunesResult(makeItunesTrack({ trackTimeMillis: duration }))?.duration_ms).toBeNull();
  });
});

describe('searchSongs', () => {
  it('searches with the browser region and maps the results', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-CA');
    const seen = serve([makeItunesTrack(), { wrapperType: 'artist' }]);

    const results = await createSongSearch()('  jamie xx ');

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Gosh');
    expect(seen).toHaveLength(1);
    expect(Object.fromEntries(seen[0]?.searchParams ?? [])).toEqual({
      media: 'music',
      entity: 'song',
      limit: '12',
      term: 'jamie xx',
      country: 'CA',
    });
  });

  it('omits country when the language has no two-letter region', async () => {
    const seen = serve();

    await createSongSearch(() => 'es-419')('gosh');

    expect(seen[0]?.searchParams.has('country')).toBe(false);
  });

  it('returns no results for a blank term without a request', async () => {
    const seen = serve();

    await expect(createSongSearch()('   ')).resolves.toEqual([]);
    expect(seen).toHaveLength(0);
  });

  it('retries once without country after a 400 and drops country for the session', async () => {
    const seen: URL[] = [];
    server.use(
      http.get(ITUNES_SEARCH_URL, ({ request }) => {
        const url = new URL(request.url);
        seen.push(url);
        return url.searchParams.has('country')
          ? new HttpResponse('Invalid value(s) for key(s): [country]', { status: 400 })
          : itunesResponse(makeItunesResponse([makeItunesTrack()]));
      }),
    );
    const search = createSongSearch(() => 'en-XX');

    await expect(search('gosh')).resolves.toHaveLength(1);
    await expect(search('gosh again')).resolves.toHaveLength(1);

    expect(seen.map((url) => url.searchParams.get('country'))).toEqual(['XX', null, null]);
  });

  it('does not retry a 400 that had no country', async () => {
    server.use(http.get(ITUNES_SEARCH_URL, () => new HttpResponse(null, { status: 400 })));

    await expect(createSongSearch(() => 'en')('gosh')).rejects.toBeInstanceOf(
      SearchUnavailableError,
    );
  });

  it.each([
    ['a 503', () => new HttpResponse(null, { status: 503 })],
    ['a network error', () => HttpResponse.error()],
    [
      'malformed JSON',
      () => new HttpResponse('{oops', { headers: { 'Content-Type': 'text/javascript' } }),
    ],
    ['a body without results', () => itunesResponse({ resultCount: 0 })],
    ['a non-object body', () => itunesResponse([1, 2])],
  ])('throws SearchUnavailableError for %s', async (_label, resolver) => {
    server.use(http.get(ITUNES_SEARCH_URL, resolver));

    const error = await createSongSearch(() => 'en')('gosh').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SearchUnavailableError);
    expect(error).toMatchObject({
      name: 'SearchUnavailableError',
      message: 'Song search is unavailable right now.',
    });
  });

  it('gives up with SearchUnavailableError when the 8 second timeout fires', async () => {
    const timer = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timer.signal);
    server.use(
      http.get(ITUNES_SEARCH_URL, async ({ request }) => {
        await new Promise((resolve) => {
          request.signal.addEventListener('abort', resolve);
        });
        return itunesResponse(makeItunesResponse([]));
      }),
    );

    const pending = createSongSearch(() => 'en')('slow', { signal: new AbortController().signal });
    timer.abort(new DOMException('The operation timed out.', 'TimeoutError'));

    expect(timeout).toHaveBeenCalledWith(SEARCH_TIMEOUT_MS);
    expect(SEARCH_TIMEOUT_MS).toBe(8000);
    await expect(pending).rejects.toBeInstanceOf(SearchUnavailableError);
  });

  it('rethrows the abort error when the caller aborts', async () => {
    server.use(
      http.get(ITUNES_SEARCH_URL, async ({ request }) => {
        await new Promise((resolve) => {
          request.signal.addEventListener('abort', resolve);
        });
        return itunesResponse(makeItunesResponse([]));
      }),
    );
    const controller = new AbortController();
    const pending = createSongSearch(() => 'en')('gosh', { signal: controller.signal });
    controller.abort();

    const error = await pending.catch((caught: unknown) => caught);

    expect(error).not.toBeInstanceOf(SearchUnavailableError);
    expect(error).toMatchObject({ name: 'AbortError' });
  });

  it('exports a default session-wide search', async () => {
    serve();

    await expect(searchSongs('gosh')).resolves.toHaveLength(1);
  });
});
