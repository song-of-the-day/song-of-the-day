/**
 * Typed view of `shared/theme-options.json`, the customization options shared with the API.
 *
 * Every option key set is mirrored as a TypeScript union because code depends on each key (fonts
 * are imported in `styles/fonts.ts`, patterns are drawn in `styles/patterns.css`, card styles and
 * views are rendered by components). {@link parseThemeOptions} checks the JSON against these unions
 * when the module loads, so the file and the code can never silently drift apart.
 */
import rawThemeOptions from '@shared/theme-options.json';

export const FONT_KEYS = [
  'inter',
  'space-grotesk',
  'space-mono',
  'vt323',
  'silkscreen',
  'orbitron',
  'playfair-display',
  'courier-prime',
  'comic-neue',
  'pacifico',
] as const;
export const PATTERN_KEYS = [
  'none',
  'grid',
  'dots',
  'stars',
  'checker',
  'stripes',
  'scanlines',
] as const;
export const IMAGE_FIT_KEYS = ['cover', 'tile'] as const;
export const CARD_STYLE_KEYS = ['window', 'polaroid', 'minimal'] as const;
export const DEFAULT_VIEW_KEYS = ['board', 'calendar'] as const;
export const NOTE_COLOR_KEYS = ['yellow', 'pink', 'blue', 'green', 'purple'] as const;
export const PRESET_KEYS = [
  'chrome',
  'bubblegum',
  'midnight-crt',
  'mint-disc',
  'sunset-mixtape',
  'paper',
] as const;

export type FontKey = (typeof FONT_KEYS)[number];
export type PatternKey = (typeof PATTERN_KEYS)[number];
export type ImageFit = (typeof IMAGE_FIT_KEYS)[number];
export type CardStyle = (typeof CARD_STYLE_KEYS)[number];
export type DefaultView = (typeof DEFAULT_VIEW_KEYS)[number];
export type NoteColorKey = (typeof NOTE_COLOR_KEYS)[number];
export type PresetKey = (typeof PRESET_KEYS)[number];

/** The `preset` value of a theme that no longer matches any preset. */
export const CUSTOM_PRESET = 'custom';

/** The five user-editable theme colors, each `#RRGGBB`. */
export interface ThemeColors {
  background: string;
  surface: string;
  text: string;
  accent: string;
  border: string;
}

export type ColorRole = keyof ThemeColors;

/** The color roles in display order. */
export const COLOR_ROLES = [
  'background',
  'surface',
  'text',
  'accent',
  'border',
] as const satisfies readonly ColorRole[];

export interface ThemeFonts {
  heading: FontKey;
  body: FontKey;
}

export type FontSlot = keyof ThemeFonts;

export interface ThemeBackground {
  pattern: PatternKey;
  /** UUID of an uploaded image; when set, the image is drawn and `pattern` is ignored. */
  image_upload_id: string | null;
  image_fit: ImageFit;
}

/** A complete profile theme, exactly as the API returns and accepts it. */
export interface Theme {
  preset: PresetKey | typeof CUSTOM_PRESET;
  colors: ThemeColors;
  fonts: ThemeFonts;
  background: ThemeBackground;
  card_style: CardStyle;
  default_view: DefaultView;
}

export interface Option<K extends string> {
  key: K;
  label: string;
}

export interface FontOption extends Option<FontKey> {
  category: string;
  /** CSS `font-family` value, including fallbacks. */
  family: string;
}

export interface NoteColorOption extends Option<NoteColorKey> {
  hex: string;
}

export interface Preset extends Option<PresetKey> {
  theme: Theme;
}

export interface ThemeOptions {
  version: number;
  defaultPreset: PresetKey;
  fonts: readonly FontOption[];
  patterns: readonly Option<PatternKey>[];
  imageFits: readonly Option<ImageFit>[];
  cardStyles: readonly Option<CardStyle>[];
  defaultViews: readonly Option<DefaultView>[];
  /** Text color for sticky notes, which never use the theme text color. */
  noteInk: string;
  noteColors: readonly NoteColorOption[];
  presets: readonly Preset[];
}

interface RawOption {
  key: string;
  label: string;
}

interface RawTheme {
  preset: string;
  colors: Record<ColorRole, string>;
  fonts: Record<FontSlot, string>;
  background: { pattern: string; image_upload_id: string | null; image_fit: string };
  card_style: string;
  default_view: string;
}

/** The shape of `shared/theme-options.json` before its keys are checked. */
export interface RawThemeOptions {
  version: number;
  default_preset: string;
  fonts: readonly (RawOption & { category: string; family: string })[];
  patterns: readonly RawOption[];
  image_fits: readonly RawOption[];
  card_styles: readonly RawOption[];
  default_views: readonly RawOption[];
  note_ink: string;
  note_colors: readonly (RawOption & { hex: string })[];
  presets: readonly (RawOption & { theme: RawTheme })[];
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

function isOneOf<K extends string>(allowed: readonly K[], value: string): value is K {
  const keys: readonly string[] = allowed;
  return keys.includes(value);
}

function toKey<K extends string>(allowed: readonly K[], value: string, where: string): K {
  if (!isOneOf(allowed, value)) {
    throw new Error(`theme-options: unknown ${where} "${value}"`);
  }
  return value;
}

function toHex(value: string, where: string): string {
  if (!HEX_COLOR.test(value)) {
    throw new Error(`theme-options: ${where} "${value}" is not a #RRGGBB color`);
  }
  return value.toUpperCase();
}

function toOptions<K extends string, T extends RawOption, R extends Option<K>>(
  allowed: readonly K[],
  raw: readonly T[],
  where: string,
  build: (option: T, key: K) => R,
): R[] {
  const options = raw.map((option) => build(option, toKey(allowed, option.key, where)));
  const missing = allowed.filter((key) => !options.some((option) => option.key === key));
  if (missing.length > 0 || options.length !== allowed.length) {
    throw new Error(
      `theme-options: ${where} keys must be exactly ${allowed.join(', ')} (missing: ${
        missing.join(', ') || 'none'
      }, listed: ${String(options.length)})`,
    );
  }
  return options;
}

function toTheme(raw: RawTheme, where: string): Theme {
  return {
    preset:
      raw.preset === CUSTOM_PRESET
        ? CUSTOM_PRESET
        : toKey(PRESET_KEYS, raw.preset, `${where}.preset`),
    colors: {
      background: toHex(raw.colors.background, `${where}.colors.background`),
      surface: toHex(raw.colors.surface, `${where}.colors.surface`),
      text: toHex(raw.colors.text, `${where}.colors.text`),
      accent: toHex(raw.colors.accent, `${where}.colors.accent`),
      border: toHex(raw.colors.border, `${where}.colors.border`),
    },
    fonts: {
      heading: toKey(FONT_KEYS, raw.fonts.heading, `${where}.fonts.heading`),
      body: toKey(FONT_KEYS, raw.fonts.body, `${where}.fonts.body`),
    },
    background: {
      pattern: toKey(PATTERN_KEYS, raw.background.pattern, `${where}.background.pattern`),
      image_upload_id: raw.background.image_upload_id,
      image_fit: toKey(IMAGE_FIT_KEYS, raw.background.image_fit, `${where}.background.image_fit`),
    },
    card_style: toKey(CARD_STYLE_KEYS, raw.card_style, `${where}.card_style`),
    default_view: toKey(DEFAULT_VIEW_KEYS, raw.default_view, `${where}.default_view`),
  };
}

/**
 * Validates the raw options file against the key unions declared in this module.
 *
 * @param raw - The parsed contents of `shared/theme-options.json`.
 * @returns The typed options.
 * @throws Error if a key list differs from its union, a color is not `#RRGGBB`, or a preset's
 *   theme references an unknown key.
 */
export function parseThemeOptions(raw: RawThemeOptions): ThemeOptions {
  const presets = toOptions(PRESET_KEYS, raw.presets, 'preset', (option, key) => {
    const theme = toTheme(option.theme, `presets.${key}.theme`);
    if (theme.preset !== key) {
      throw new Error(`theme-options: preset "${key}" has theme.preset "${theme.preset}"`);
    }
    return { key, label: option.label, theme };
  });
  return {
    version: raw.version,
    defaultPreset: toKey(PRESET_KEYS, raw.default_preset, 'default_preset'),
    fonts: toOptions(FONT_KEYS, raw.fonts, 'font', (option, key) => ({
      key,
      label: option.label,
      category: option.category,
      family: option.family,
    })),
    patterns: toOptions(PATTERN_KEYS, raw.patterns, 'pattern', (option, key) => ({
      key,
      label: option.label,
    })),
    imageFits: toOptions(IMAGE_FIT_KEYS, raw.image_fits, 'image fit', (option, key) => ({
      key,
      label: option.label,
    })),
    cardStyles: toOptions(CARD_STYLE_KEYS, raw.card_styles, 'card style', (option, key) => ({
      key,
      label: option.label,
    })),
    defaultViews: toOptions(
      DEFAULT_VIEW_KEYS,
      raw.default_views,
      'default view',
      (option, key) => ({
        key,
        label: option.label,
      }),
    ),
    noteInk: toHex(raw.note_ink, 'note_ink'),
    noteColors: toOptions(NOTE_COLOR_KEYS, raw.note_colors, 'note color', (option, key) => ({
      key,
      label: option.label,
      hex: toHex(option.hex, `note_colors.${key}.hex`),
    })),
    presets,
  };
}

/** The validated contents of `shared/theme-options.json`. */
export const themeOptions: ThemeOptions = parseThemeOptions(rawThemeOptions);
