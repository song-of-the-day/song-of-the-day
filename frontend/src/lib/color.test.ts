import { describe, expect, it } from 'vitest';

import {
  bestContrastText,
  checkThemeContrast,
  contrastRatio,
  deriveMuted,
  formatHex,
  isHexColor,
  mix,
  normalizeHex,
  parseHex,
  relativeLuminance,
} from './color';
import { defaultTheme, presets, withField } from './theme';

describe('isHexColor / parseHex / formatHex', () => {
  it('accepts only #RRGGBB as the API color format', () => {
    expect(isHexColor('#A1b2C3')).toBe(true);
    expect(isHexColor('#abc')).toBe(false);
    expect(isHexColor('A1B2C3')).toBe(false);
    expect(isHexColor('#A1B2C3 ')).toBe(false);
  });

  it('parses 3- and 6-digit hex', () => {
    expect(parseHex('#5B4BFF')).toEqual({ r: 91, g: 75, b: 255 });
    expect(parseHex('#fa0')).toEqual({ r: 255, g: 170, b: 0 });
  });

  it.each(['', '#', '#12', '#12345', '#1234567', 'red', '#GGGGGG', 'rgb(0,0,0)'])(
    'rejects %j',
    (value) => {
      expect(parseHex(value)).toBeNull();
    },
  );

  it('formats upper-case, rounding and clamping channels', () => {
    expect(formatHex({ r: 91, g: 75, b: 255 })).toBe('#5B4BFF');
    expect(formatHex({ r: -4, g: 127.6, b: 300 })).toBe('#0080FF');
  });

  it('normalizes hex strings and rejects invalid ones', () => {
    expect(normalizeHex('#fa0')).toBe('#FFAA00');
    expect(() => normalizeHex('blue')).toThrow('Invalid hex color: "blue"');
  });
});

describe('relativeLuminance / contrastRatio', () => {
  it('computes WCAG luminance', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBe(1);
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 4);
    // Below the linear threshold.
    expect(relativeLuminance('#0A0A0A')).toBeCloseTo(10 / 255 / 12.92, 6);
  });

  it('computes contrast ratios symmetrically', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBe(21);
    expect(contrastRatio('#FFFFFF', '#000000')).toBe(21);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
    expect(contrastRatio('#1C1A24', '#FFFFFF')).toBeCloseTo(17.18, 2);
  });

  it('throws on invalid colors', () => {
    expect(() => contrastRatio('#000000', 'nope')).toThrow('Invalid hex color');
  });
});

describe('mix', () => {
  it('interpolates in sRGB and clamps the amount', () => {
    expect(mix('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mix('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mix('#1C1A24', '#FFFFFF', 0.35)).toBe('#6B6A71');
    expect(mix('#102030', '#FFFFFF', -1)).toBe('#102030');
    expect(mix('#102030', '#FFFFFF', 2)).toBe('#FFFFFF');
  });
});

describe('bestContrastText', () => {
  it('picks whichever of black and white contrasts more', () => {
    expect(bestContrastText('#5B4BFF')).toBe('#FFFFFF');
    expect(bestContrastText('#33FF85')).toBe('#000000');
    expect(bestContrastText('#000000')).toBe('#FFFFFF');
    expect(bestContrastText('#FFFFFF')).toBe('#000000');
  });
});

describe('deriveMuted', () => {
  it('uses the 35% mix when it already meets 4.5:1', () => {
    expect(deriveMuted('#1C1A24', '#FFFFFF')).toBe('#6B6A71');
  });

  it('steps back toward the text color until it reaches 4.5:1', () => {
    // 35% toward white is too light; 19% is the first step that reaches 4.5:1.
    expect(contrastRatio(mix('#555555', '#FFFFFF', 0.35), '#FFFFFF')).toBeLessThan(4.5);
    expect(contrastRatio(mix('#555555', '#FFFFFF', 0.2), '#FFFFFF')).toBeLessThan(4.5);
    expect(deriveMuted('#555555', '#FFFFFF')).toBe('#757575');
    expect(deriveMuted('#333333', '#DDDDDD')).toBe('#616161');
  });

  it('falls back to the text color when no mix reaches 4.5:1', () => {
    expect(deriveMuted('#767676', '#FFFFFF')).toBe('#767676');
    expect(deriveMuted('#999999', '#ffffff')).toBe('#999999');
    expect(deriveMuted('#abc', '#FFFFFF')).toBe('#AABBCC');
  });
});

describe('checkThemeContrast', () => {
  it('passes every preset', () => {
    for (const preset of presets) {
      expect(checkThemeContrast(preset.theme), preset.key).toEqual([]);
    }
  });

  it('reports each failing pair with its ratio and minimum', () => {
    const theme = withField(defaultTheme(), {
      colors: { text: '#BBBBBB', surface: '#FFFFFF', accent: '#DDDDDD' },
    });

    const issues = checkThemeContrast(theme);

    expect(issues.map((issue) => issue.pair)).toEqual([
      'text-surface',
      'muted-surface',
      'accent-surface',
    ]);
    expect(issues[0]).toMatchObject({
      label: 'Text on surface',
      foreground: '#BBBBBB',
      background: '#FFFFFF',
      minimum: 4.5,
    });
    expect(issues[0]?.ratio).toBeCloseTo(contrastRatio('#BBBBBB', '#FFFFFF'), 6);
    expect(issues[2]).toMatchObject({ label: 'Accent on surface', minimum: 3 });
  });

  it('never fails the accent-contrast pair, since black or white always reaches 4.5:1', () => {
    for (let level = 0; level <= 255; level += 1) {
      const gray = formatHex({ r: level, g: level, b: level });
      const theme = withField(defaultTheme(), { colors: { accent: gray } });

      expect(checkThemeContrast(theme).map((issue) => issue.pair)).not.toContain('accent-contrast');
    }
  });
});
