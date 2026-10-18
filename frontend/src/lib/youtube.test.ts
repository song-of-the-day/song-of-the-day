import { describe, expect, it } from 'vitest';

import { parseYouTubeId, searchUrl, watchUrl } from './youtube';

const ID = 'dQw4w9WgXcQ';

describe('parseYouTubeId', () => {
  it.each([
    ID,
    `  ${ID}  `,
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s&list=PL123&si=abc`,
    `http://www.youtube.com/watch?feature=share&v=${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}&si=xyz`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc&t=10`,
    `youtu.be/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://youtube.com/shorts/${ID}?feature=share`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/embed/${ID}/`,
    `https://www.youtube-nocookie.com/embed/${ID}?start=30`,
    `https://youtube-nocookie.com/embed/${ID}`,
    `HTTPS://WWW.YOUTUBE.COM/watch?v=${ID}`,
  ])('extracts the id from %j', (input) => {
    expect(parseYouTubeId(input)).toBe(ID);
  });

  it.each([
    '',
    'dQw4w9WgXc',
    'dQw4w9WgXcQQ',
    'dQw4w9WgX!Q',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/channel/UC123',
    'https://www.youtube.com/shorts/',
    'https://youtu.be/',
    `https://vimeo.com/${ID}`,
    `https://youtube.com.evil.com/watch?v=${ID}`,
    `https://www.youtube-nocookie.com/watch?v=${ID}`,
    `ftp://youtube.com/watch?v=${ID}`,
    `javascript:alert('${ID}')`,
    'http://',
  ])('rejects %j', (input) => {
    expect(parseYouTubeId(input)).toBeNull();
  });
});

describe('watchUrl / searchUrl', () => {
  it('builds the watch URL', () => {
    expect(watchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });

  it('builds an encoded search URL from artist and title', () => {
    expect(searchUrl('Jamie xx', 'Gosh & Co')).toBe(
      'https://www.youtube.com/results?search_query=Jamie%20xx%20Gosh%20%26%20Co',
    );
  });
});
