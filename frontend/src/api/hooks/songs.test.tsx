import { waitFor } from '@testing-library/react';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { apiErrorResponse, fakeApi } from '@/test/fakeApi';
import { renderHookWithProviders } from '@/test/render';
import { server } from '@/test/server';

import { useYouTubeMatch } from './songs';

const TRACK = { title: 'Gosh', artist: 'Jamie xx', duration_ms: 290_973, source_id: '1525506452' };

const MATCH = {
  video_id: 'dQw4w9WgXcQ',
  title: 'Jamie xx - Gosh',
  channel_title: 'Jamie xx - Topic',
  duration_ms: 290_000,
  score: 0.93,
  confidence: 'high' as const,
};

function matchRequests(): number {
  return fakeApi.requests.filter((request) => request.path === '/api/songs/youtube-match').length;
}

describe('useYouTubeMatch', () => {
  it('stays idle without a track', () => {
    const { result } = renderHookWithProviders(() => useYouTubeMatch(null));

    expect(result.current.fetchStatus).toBe('idle');
    expect(matchRequests()).toBe(0);
  });

  it('stays idle when disabled', () => {
    const user = fakeApi.seedUser();
    const { result } = renderHookWithProviders(() => useYouTubeMatch(TRACK, { enabled: false }), {
      user,
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(matchRequests()).toBe(0);
  });

  it('returns the matched video', async () => {
    const user = fakeApi.seedUser();
    fakeApi.setYouTubeMatch({ match: MATCH, reason: 'matched' });
    const { result } = renderHookWithProviders(() => useYouTubeMatch(TRACK), { user });

    await waitFor(() => {
      expect(result.current.data?.match?.video_id).toBe(MATCH.video_id);
    });
    expect(result.current.data?.reason).toBe('matched');
  });

  it('caches the answer per track', async () => {
    const user = fakeApi.seedUser();
    fakeApi.setYouTubeMatch({ match: MATCH, reason: 'matched' });
    const first = renderHookWithProviders(() => useYouTubeMatch(TRACK), { user });
    await waitFor(() => {
      expect(first.result.current.isSuccess).toBe(true);
    });

    const second = renderHookWithProviders(() => useYouTubeMatch({ ...TRACK }), {
      user,
      queryClient: first.queryClient,
    });

    expect(second.result.current.data).toEqual(first.result.current.data);
    expect(matchRequests()).toBe(1);
  });

  it('fails without retrying', async () => {
    server.use(
      http.get('/api/songs/youtube-match', () => apiErrorResponse(500, 'internal_error', 'x')),
    );
    const user = fakeApi.seedUser();
    const { result } = renderHookWithProviders(() => useYouTubeMatch(TRACK), { user });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(matchRequests()).toBe(1);
  });
});
