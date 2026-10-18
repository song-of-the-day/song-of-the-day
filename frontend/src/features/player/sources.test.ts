import { describe, expect, it } from 'vitest';

import { choosePlayer, type PlayerSource } from './sources';

const ITUNES: PlayerSource = {
  youtube_video_id: null,
  source: 'itunes',
  preview_url: 'https://audio-ssl.itunes.apple.com/preview.m4a',
};

describe('choosePlayer', () => {
  it('always prefers an attached YouTube video', () => {
    expect(choosePlayer({ ...ITUNES, youtube_video_id: 'dQw4w9WgXcQ' })).toEqual({
      kind: 'youtube',
      videoId: 'dQw4w9WgXcQ',
    });
    expect(
      choosePlayer({
        ...ITUNES,
        source: 'manual',
        preview_url: null,
        youtube_video_id: 'x'.repeat(11),
      }),
    ).toEqual({ kind: 'youtube', videoId: 'x'.repeat(11) });
  });

  it('uses the Apple preview for an iTunes song with a preview, without a track id', () => {
    expect(choosePlayer(ITUNES)).toEqual({
      kind: 'preview',
      previewUrl: ITUNES.preview_url,
    });
  });

  it.each([
    ['a manual entry', { source: 'manual' as const }],
    ['no preview URL', { preview_url: null }],
  ])('shows no player for %s', (_case, overrides) => {
    expect(choosePlayer({ ...ITUNES, ...overrides })).toEqual({ kind: 'none' });
  });
});
