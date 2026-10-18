import { describe, expect, it } from 'vitest';

import { fakeApi } from '@/test/fakeApi';

import { getYouTubeMatch } from './songs';

const TRACK = {
  title: 'Gosh',
  artist: 'Jamie xx',
  album: 'In Colour',
  duration_ms: 290_973,
  source_id: '1525506452',
};

const MATCH = {
  video_id: 'dQw4w9WgXcQ',
  title: 'Jamie xx - Gosh',
  channel_title: 'Jamie xx - Topic',
  duration_ms: 290_000,
  score: 0.93,
  confidence: 'high' as const,
};

function signedIn() {
  const user = fakeApi.seedUser();
  fakeApi.signIn(user.id);
  return user;
}

function lastQuery(): URLSearchParams {
  return new URLSearchParams(fakeApi.requests.at(-1)?.search ?? '');
}

describe('getYouTubeMatch', () => {
  it("returns the server's suggestion and sends the whole track", async () => {
    signedIn();
    fakeApi.setYouTubeMatch({ match: MATCH, reason: 'matched' });

    await expect(getYouTubeMatch(TRACK)).resolves.toEqual({ match: MATCH, reason: 'matched' });

    expect(fakeApi.requests.at(-1)?.path).toBe('/api/songs/youtube-match');
    expect(Object.fromEntries(lastQuery())).toEqual({
      title: 'Gosh',
      artist: 'Jamie xx',
      album: 'In Colour',
      duration_ms: '290973',
      source_id: '1525506452',
    });
  });

  it('reports why there is no match, without the unset optionals', async () => {
    signedIn();

    await expect(getYouTubeMatch({ title: 'Gosh', artist: 'Jamie xx' })).resolves.toEqual({
      match: null,
      reason: 'disabled',
    });
    expect(lastQuery().has('duration_ms')).toBe(false);
    expect(lastQuery().has('source_id')).toBe(false);
  });

  it('requires a login', async () => {
    await expect(getYouTubeMatch({ title: 'Gosh', artist: 'Jamie xx' })).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
  });

  it('rejects an invalid query', async () => {
    signedIn();

    await expect(getYouTubeMatch({ title: '', artist: 'Jamie xx' })).rejects.toMatchObject({
      status: 422,
      code: 'validation_error',
    });
  });
});
