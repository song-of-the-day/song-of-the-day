import { describe, expect, it } from 'vitest';

import { cdPlaceholder, hashString } from './hash';

describe('hashString', () => {
  it('matches known FNV-1a values', () => {
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
    expect(hashString('foobar')).toBe(0xbf9cf968);
  });

  it('is an unsigned 32-bit integer', () => {
    for (const value of ['Gosh', 'Jamie xx', '✦ sparkle ✦', 'x'.repeat(1000)]) {
      const hash = hashString(value);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThan(2 ** 32);
    }
  });
});

describe('cdPlaceholder', () => {
  it('is stable for the same song', () => {
    expect(cdPlaceholder('Gosh', 'Jamie xx')).toEqual(cdPlaceholder('Gosh', 'Jamie xx'));
  });

  it('differs between songs, including shifted title/artist splits', () => {
    expect(cdPlaceholder('Gosh', 'Jamie xx')).not.toEqual(cdPlaceholder('Loud Places', 'Jamie xx'));
    expect(cdPlaceholder('ab', 'c')).not.toEqual(cdPlaceholder('a', 'bc'));
  });

  it('produces a conic gradient from its angle and colors', () => {
    const { angle, colors, backgroundImage } = cdPlaceholder('Teardrop', 'Massive Attack');

    expect(angle).toBeGreaterThanOrEqual(0);
    expect(angle).toBeLessThan(360);
    expect(colors).toHaveLength(3);
    for (const color of colors) {
      expect(color).toMatch(/^hsl\(\d{1,3} \d{2}% \d{2}%\)$/);
    }
    expect(backgroundImage).toBe(
      `conic-gradient(from ${String(angle)}deg, ${colors[0]}, ${colors[1]}, ${colors[2]}, ${colors[0]})`,
    );
  });
});
