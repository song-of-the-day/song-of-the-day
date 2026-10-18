import { describe, expect, it } from 'vitest';

import rawThemeOptions from '@shared/theme-options.json';

import {
  CARD_STYLE_KEYS,
  FONT_KEYS,
  NOTE_COLOR_KEYS,
  parseThemeOptions,
  PATTERN_KEYS,
  PRESET_KEYS,
  themeOptions,
  type RawThemeOptions,
} from './themeOptions';

function raw(): RawThemeOptions {
  return structuredClone(rawThemeOptions);
}

describe('themeOptions', () => {
  it('loads every option list from the shared file in file order', () => {
    expect(themeOptions.version).toBe(1);
    expect(themeOptions.defaultPreset).toBe('chrome');
    expect(themeOptions.fonts.map((font) => font.key)).toEqual(FONT_KEYS);
    expect(themeOptions.patterns.map((pattern) => pattern.key)).toEqual(PATTERN_KEYS);
    expect(themeOptions.cardStyles.map((style) => style.key)).toEqual(CARD_STYLE_KEYS);
    expect(themeOptions.noteColors.map((color) => color.key)).toEqual(NOTE_COLOR_KEYS);
    expect(themeOptions.presets.map((preset) => preset.key)).toEqual(PRESET_KEYS);
    expect(themeOptions.imageFits).toEqual([
      { key: 'cover', label: 'Fill' },
      { key: 'tile', label: 'Tile' },
    ]);
    expect(themeOptions.defaultViews.map((view) => view.label)).toEqual(['Board', 'Calendar']);
    expect(themeOptions.noteInk).toBe('#1C1A24');
  });

  it('keeps font metadata and preset themes', () => {
    expect(themeOptions.fonts[0]).toEqual({
      key: 'inter',
      label: 'Inter',
      category: 'sans',
      family: "'Inter Variable', 'Inter', system-ui, sans-serif",
    });
    expect(themeOptions.presets[0]?.theme).toEqual({
      preset: 'chrome',
      colors: {
        background: '#E8E6F0',
        surface: '#FFFFFF',
        text: '#1C1A24',
        accent: '#5B4BFF',
        border: '#B8B3CC',
      },
      fonts: { heading: 'silkscreen', body: 'inter' },
      background: { pattern: 'grid', image_upload_id: null, image_fit: 'cover' },
      card_style: 'window',
      default_view: 'calendar',
    });
  });
});

describe('parseThemeOptions', () => {
  it('upper-cases colors', () => {
    const options = raw();
    options.note_ink = '#abcdef';

    expect(parseThemeOptions(options).noteInk).toBe('#ABCDEF');
  });

  it('rejects a preset theme marked custom', () => {
    const options = raw();
    const chrome = options.presets[0];
    if (chrome === undefined) throw new Error('fixture');
    chrome.theme.preset = 'custom';

    expect(() => parseThemeOptions(options)).toThrow('preset "chrome" has theme.preset "custom"');
  });

  it.each<[string, (options: RawThemeOptions) => void, string]>([
    [
      'an unknown font key',
      (options) => {
        options.fonts = [
          ...options.fonts,
          { key: 'papyrus', label: 'P', category: 'x', family: 'P' },
        ];
      },
      'unknown font "papyrus"',
    ],
    [
      'a missing pattern key',
      (options) => {
        options.patterns = options.patterns.filter((pattern) => pattern.key !== 'stars');
      },
      'pattern keys must be exactly',
    ],
    [
      'a duplicated card style',
      (options) => {
        options.card_styles = [...options.card_styles, { key: 'window', label: 'Again' }];
      },
      'card style keys must be exactly',
    ],
    [
      'an unknown default preset',
      (options) => {
        options.default_preset = 'vaporwave';
      },
      'unknown default_preset "vaporwave"',
    ],
    [
      'a malformed note color',
      (options) => {
        options.note_colors = options.note_colors.map((color) => ({ ...color, hex: 'yellow' }));
      },
      'note_colors.yellow.hex "yellow" is not a #RRGGBB color',
    ],
    [
      'a preset with an unknown heading font',
      (options) => {
        const preset = options.presets[1];
        if (preset !== undefined) preset.theme.fonts.heading = 'papyrus';
      },
      'unknown presets.bubblegum.theme.fonts.heading "papyrus"',
    ],
    [
      'a preset whose theme names another preset',
      (options) => {
        const preset = options.presets[2];
        if (preset !== undefined) preset.theme.preset = 'paper';
      },
      'preset "midnight-crt" has theme.preset "paper"',
    ],
    [
      'a preset with a bad color',
      (options) => {
        const preset = options.presets[0];
        if (preset !== undefined) preset.theme.colors.accent = '#12345';
      },
      'presets.chrome.theme.colors.accent "#12345" is not a #RRGGBB color',
    ],
  ])('rejects %s', (_label, mutate, message) => {
    const options = raw();
    mutate(options);

    expect(() => parseThemeOptions(options)).toThrow(message);
  });
});
