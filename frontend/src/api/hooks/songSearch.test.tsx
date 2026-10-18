import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { SearchUnavailableError } from '@/lib/itunes';
import { ITUNES_SEARCH_URL } from '@/test/fakeItunes';
import { renderHookWithProviders } from '@/test/render';
import { server } from '@/test/server';

import { useSongSearch } from './songSearch';

function countSearches(): { count: number } {
  const counter = { count: 0 };
  server.events.on('request:start', ({ request }) => {
    if (request.url.startsWith(ITUNES_SEARCH_URL)) {
      counter.count += 1;
    }
  });
  return counter;
}

describe('useSongSearch', () => {
  it('stays idle below two characters', () => {
    const counter = countSearches();
    const { result } = renderHookWithProviders(() => useSongSearch(' j '));

    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(counter.count).toBe(0);
  });

  it('searches the trimmed term', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en');
    const { result } = renderHookWithProviders(() => useSongSearch('  jamie '));

    await waitFor(() => {
      expect(result.current.data?.map((song) => song.title)).toEqual(['Gosh', 'Loud Places']);
    });
  });

  it('caches results per term', async () => {
    const counter = countSearches();
    const first = renderHookWithProviders(() => useSongSearch('teardrop'));
    await waitFor(() => {
      expect(first.result.current.isSuccess).toBe(true);
    });

    const second = renderHookWithProviders(() => useSongSearch('teardrop'), {
      queryClient: first.queryClient,
    });

    expect(second.result.current.data).toEqual(first.result.current.data);
    expect(counter.count).toBe(1);
  });

  it('fails with SearchUnavailableError without retrying', async () => {
    const counter = countSearches();
    server.use(http.get(ITUNES_SEARCH_URL, () => new HttpResponse(null, { status: 503 })));
    const { result } = renderHookWithProviders(() => useSongSearch('gosh'));

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(SearchUnavailableError);
    });
    expect(counter.count).toBe(1);
  });
});
