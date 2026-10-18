import { describe, expect, it } from 'vitest';

import { listenOnLinks, type ListenOnSource } from './platforms';

const DEFAULT: ListenOnSource = {
  artist: 'Jamie xx',
  title: 'Gosh',
  source_id: null,
  youtube_video_id: null,
  external_url: null,
};

const QUERY = 'Jamie%20xx%20Gosh';

function links(overrides: Partial<ListenOnSource> = {}) {
  return listenOnLinks({ ...DEFAULT, ...overrides });
}

function keys(overrides: Partial<ListenOnSource> = {}) {
  return links(overrides).map((link) => link.key);
}

function hrefOf(overrides: Partial<ListenOnSource>, key: string): string | undefined {
  return links(overrides).find((link) => link.key === key)?.href;
}

describe('listenOnLinks', () => {
  it('builds the seven platform searches in order when there is no external link', () => {
    const result = links();

    expect(result).toEqual([
      { key: 'spotify', label: 'Spotify', href: `https://open.spotify.com/search/${QUERY}` },
      {
        key: 'apple',
        label: 'Apple Music',
        href: `https://music.apple.com/search?term=${QUERY}`,
      },
      {
        key: 'youtube',
        label: 'YouTube Music',
        href: `https://music.youtube.com/search?q=${QUERY}`,
      },
      {
        key: 'amazon',
        label: 'Amazon Music',
        href: `https://music.amazon.com/search/${QUERY}`,
      },
      { key: 'tidal', label: 'Tidal', href: `https://listen.tidal.com/search?q=${QUERY}` },
      { key: 'deezer', label: 'Deezer', href: `https://www.deezer.com/search/${QUERY}` },
      {
        key: 'soundcloud',
        label: 'SoundCloud',
        href: `https://soundcloud.com/search/sounds?q=${QUERY}`,
      },
    ]);
  });

  it('encodes the artist and title in the search query', () => {
    expect(hrefOf({ artist: 'Björk', title: 'Jóga' }, 'spotify')).toBe(
      `https://open.spotify.com/search/${encodeURIComponent('Björk Jóga')}`,
    );
  });

  it('links to the Apple song when the entry has a source id', () => {
    expect(hrefOf({ source_id: '1525506452' }, 'apple')).toBe(
      'https://music.apple.com/song/1525506452',
    );
  });

  it('links to the YouTube video when the entry has one', () => {
    expect(hrefOf({ youtube_video_id: 'dQw4w9WgXcQ' }, 'youtube')).toBe(
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
    );
  });

  it.each([
    ['spotify', 'https://open.spotify.com/track/abc'],
    ['apple', 'https://music.apple.com/us/album/gosh/1525506447?i=1525506452'],
    ['youtube', 'https://music.youtube.com/watch?v=xyz'],
    ['amazon', 'https://music.amazon.co.uk/albums/B123'],
    ['tidal', 'https://listen.tidal.com/album/123'],
    ['deezer', 'https://www.deezer.com/track/456'],
    ['soundcloud', 'https://on.soundcloud.com/abc'],
  ])('uses the external link for the %s row', (key, external_url) => {
    expect(hrefOf({ external_url }, key)).toBe(external_url);
    // The host belongs to a row, so no extra link is added.
    expect(keys({ external_url })).not.toContain('extra');
  });

  it('still uses the external link for a plain tidal.com host', () => {
    expect(hrefOf({ external_url: 'https://tidal.com/album/123' }, 'tidal')).toBe(
      'https://tidal.com/album/123',
    );
  });

  it('lets the source id win over an Apple external link, without adding an extra link', () => {
    const overrides = {
      source_id: '1525506452',
      external_url: 'https://music.apple.com/us/album/gosh/1525506447?i=1525506452',
    };

    expect(hrefOf(overrides, 'apple')).toBe('https://music.apple.com/song/1525506452');
    expect(keys(overrides)).not.toContain('extra');
  });

  it('lets the YouTube video win over a YouTube Music external link', () => {
    const overrides = {
      youtube_video_id: 'dQw4w9WgXcQ',
      external_url: 'https://music.youtube.com/watch?v=other',
    };

    expect(hrefOf(overrides, 'youtube')).toBe('https://music.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(keys(overrides)).not.toContain('extra');
  });

  it.each(['https://bandcamp.com/album/x', 'https://artist.bandcamp.com/album/x'])(
    'adds one Bandcamp link for %s',
    (external_url) => {
      expect(links({ external_url }).at(-1)).toEqual({
        key: 'extra',
        label: 'Bandcamp',
        href: external_url,
      });
    },
  );

  it('labels any other host by its bare hostname', () => {
    expect(links({ external_url: 'https://www.example.com/songs/1' }).at(-1)).toEqual({
      key: 'extra',
      label: 'example.com',
      href: 'https://www.example.com/songs/1',
    });
    expect(links({ external_url: 'https://store.example.com/x' }).at(-1)?.label).toBe(
      'store.example.com',
    );
  });

  it('adds no extra link for a URL it cannot parse', () => {
    expect(keys({ external_url: 'not a url' })).not.toContain('extra');
  });

  it('still searches every platform when the external link belongs to none of them', () => {
    const overrides = { external_url: 'https://www.example.com/songs/1' };

    expect(hrefOf(overrides, 'spotify')).toBe(`https://open.spotify.com/search/${QUERY}`);
    expect(hrefOf(overrides, 'soundcloud')).toBe(`https://soundcloud.com/search/sounds?q=${QUERY}`);
  });
});
