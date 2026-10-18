import { describe, expect, it } from 'vitest';

import { makeEntry, makeSongResult } from '@/test/fixtures';

import { sameSong, songByline, songFromEntry } from './songDraft';

describe('songFromEntry', () => {
  it("reads an entry's song fields only", () => {
    const entry = makeEntry();

    expect(songFromEntry(entry)).toEqual({
      source: 'itunes',
      source_id: entry.source_id,
      title: 'Gosh',
      artist: 'Jamie xx',
      album: 'In Colour',
      artwork_url: entry.artwork_url,
      preview_url: entry.preview_url,
      external_url: entry.external_url,
      duration_ms: 290973,
    });
  });
});

describe('sameSong', () => {
  it('compares every song field', () => {
    const song = makeSongResult();

    expect(sameSong(song, { ...song })).toBe(true);
    expect(sameSong(song, { ...song, duration_ms: null })).toBe(false);
    expect(sameSong(song, { ...song, source: 'manual' })).toBe(false);
  });
});

describe('songByline', () => {
  it('joins the artist and album', () => {
    expect(songByline({ artist: 'Jamie xx', album: 'In Colour' })).toBe('Jamie xx · In Colour');
    expect(songByline({ artist: 'Jamie xx', album: null })).toBe('Jamie xx');
  });
});
