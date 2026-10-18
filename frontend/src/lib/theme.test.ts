import { describe, expect, it } from 'vitest';

import {
  applyPreset,
  CUSTOM_PRESET,
  defaultTheme,
  fontFamily,
  getPreset,
  isPresetKey,
  markCustom,
  presets,
  themesEqual,
  themeToCssVars,
  uploadUrl,
  withField,
  type FontKey,
  type PresetKey,
  type Theme,
} from './theme';

const IMAGE_ID = '6f1c2a5e-8d1b-4c1e-9f57-0b6f7d2a9c11';

function customized(): Theme {
  return {
    ...withField(defaultTheme(), {
      colors: { accent: '#FF0000' },
      background: { image_upload_id: IMAGE_ID, image_fit: 'tile' },
      default_view: 'calendar',
    }),
  };
}

describe('defaultTheme', () => {
  it('is the default preset', () => {
    expect(defaultTheme()).toEqual(getPreset('chrome').theme);
  });

  it('returns a fresh copy each time', () => {
    const theme = defaultTheme();
    theme.colors.text = '#000000';
    theme.background.pattern = 'none';

    expect(defaultTheme().colors.text).toBe('#1C1A24');
    expect(getPreset('chrome').theme.background.pattern).toBe('grid');
  });
});

describe('getPreset / isPresetKey', () => {
  it('finds presets by key', () => {
    expect(getPreset('midnight-crt').label).toBe('Midnight CRT');
    expect(presets).toHaveLength(6);
  });

  it('throws for an unknown key', () => {
    expect(() => getPreset('nope' as PresetKey)).toThrow('Unknown preset "nope"');
  });

  it('narrows preset keys but not "custom"', () => {
    expect(isPresetKey('paper')).toBe(true);
    expect(isPresetKey(CUSTOM_PRESET)).toBe(false);
    expect(isPresetKey('')).toBe(false);
  });
});

describe('applyPreset', () => {
  it('replaces colors, fonts, pattern and card style, and sets preset', () => {
    const result = applyPreset(customized(), 'bubblegum');
    const bubblegum = getPreset('bubblegum').theme;

    expect(result.preset).toBe('bubblegum');
    expect(result.colors).toEqual(bubblegum.colors);
    expect(result.fonts).toEqual(bubblegum.fonts);
    expect(result.background.pattern).toBe('dots');
    expect(result.card_style).toBe('polaroid');
  });

  it('keeps the image, its fit and the default view', () => {
    const result = applyPreset(customized(), 'paper');

    expect(result.background.image_upload_id).toBe(IMAGE_ID);
    expect(result.background.image_fit).toBe('tile');
    expect(result.default_view).toBe('calendar');
  });

  it('does not share objects with the preset', () => {
    const result = applyPreset(defaultTheme(), 'mint-disc');
    result.colors.accent = '#000000';
    result.fonts.body = 'pacifico';

    expect(getPreset('mint-disc').theme.colors.accent).toBe('#007A5C');
    expect(getPreset('mint-disc').theme.fonts.body).toBe('space-grotesk');
  });
});

describe('markCustom / withField', () => {
  it('marks a theme custom without changing anything else', () => {
    const theme = defaultTheme();
    const result = markCustom(theme);

    expect(result).toEqual({ ...theme, preset: 'custom' });
    expect(theme.preset).toBe('chrome');
  });

  it('merges nested edits and marks the theme custom', () => {
    const theme = defaultTheme();
    const result = withField(theme, {
      colors: { text: '#111111' },
      fonts: { heading: 'vt323' },
      background: { pattern: 'stars' },
    });

    expect(result.preset).toBe('custom');
    expect(result.colors).toEqual({ ...theme.colors, text: '#111111' });
    expect(result.fonts).toEqual({ heading: 'vt323', body: 'inter' });
    expect(result.background).toEqual({ ...theme.background, pattern: 'stars' });
    expect(theme.colors.text).toBe('#1C1A24');
  });

  it('edits top-level fields', () => {
    const result = withField(defaultTheme(), { card_style: 'minimal', default_view: 'calendar' });

    expect(result.card_style).toBe('minimal');
    expect(result.default_view).toBe('calendar');
  });

  it('marks custom even for an empty edit', () => {
    expect(withField(defaultTheme(), {}).preset).toBe('custom');
  });
});

describe('themesEqual', () => {
  it('compares every field, colors case-insensitively', () => {
    const theme = defaultTheme();

    expect(themesEqual(theme, defaultTheme())).toBe(true);
    expect(themesEqual(theme, { ...theme, colors: { ...theme.colors, accent: '#5b4bff' } })).toBe(
      true,
    );
    expect(themesEqual(theme, markCustom(theme))).toBe(false);
    expect(themesEqual(theme, withField(theme, { colors: { accent: '#000000' } }))).toBe(false);
  });

  it.each<[string, Theme]>([
    ['heading font', { ...defaultTheme(), fonts: { heading: 'vt323', body: 'inter' } }],
    ['body font', { ...defaultTheme(), fonts: { heading: 'silkscreen', body: 'vt323' } }],
    [
      'pattern',
      { ...defaultTheme(), background: { ...defaultTheme().background, pattern: 'dots' } },
    ],
    [
      'image',
      {
        ...defaultTheme(),
        background: { ...defaultTheme().background, image_upload_id: IMAGE_ID },
      },
    ],
    [
      'image fit',
      { ...defaultTheme(), background: { ...defaultTheme().background, image_fit: 'tile' } },
    ],
    ['card style', { ...defaultTheme(), card_style: 'minimal' }],
    ['default view', { ...defaultTheme(), default_view: 'board' }],
  ])('detects a different %s', (_field, other) => {
    expect(themesEqual(defaultTheme(), other)).toBe(false);
  });
});

describe('fontFamily / uploadUrl', () => {
  it('resolves font keys to families', () => {
    expect(fontFamily('pacifico')).toBe("'Pacifico', cursive");
    expect(fontFamily('playfair-display')).toBe(
      "'Playfair Display Variable', 'Playfair Display', Georgia, serif",
    );
  });

  it('throws for an unknown font', () => {
    expect(() => fontFamily('papyrus' as FontKey)).toThrow('Unknown font "papyrus"');
  });

  it('builds the upload URL', () => {
    expect(uploadUrl(IMAGE_ID)).toBe(`/api/uploads/${IMAGE_ID}`);
    expect(uploadUrl('a/b')).toBe('/api/uploads/a%2Fb');
  });
});

describe('themeToCssVars', () => {
  it('maps the default theme, including derived colors', () => {
    expect(themeToCssVars(defaultTheme())).toEqual({
      '--sotd-bg': '#E8E6F0',
      '--sotd-surface': '#FFFFFF',
      '--sotd-text': '#1C1A24',
      '--sotd-accent': '#5B4BFF',
      '--sotd-border': '#B8B3CC',
      '--sotd-muted': '#6B6A71',
      '--sotd-accent-contrast': '#FFFFFF',
      '--sotd-font-heading': "'Silkscreen', ui-monospace, monospace",
      '--sotd-font-body': "'Inter Variable', 'Inter', system-ui, sans-serif",
      '--sotd-note-ink': '#1C1A24',
    });
  });

  it('picks black accent text on a bright accent', () => {
    const vars = themeToCssVars(getPreset('midnight-crt').theme);

    expect(vars['--sotd-accent-contrast']).toBe('#000000');
    expect(vars['--sotd-muted']).toBe('#7DA68B');
    expect(vars['--sotd-font-heading']).toBe("'VT323', ui-monospace, monospace");
  });

  it('normalizes lower-case colors', () => {
    const vars = themeToCssVars(withField(defaultTheme(), { colors: { background: '#abcdef' } }));

    expect(vars['--sotd-bg']).toBe('#ABCDEF');
  });
});
