/**
 * Theme operations: defaults, presets, edits and the mapping to `--sotd-*` CSS variables.
 *
 * Also re-exports the typed theme options so feature code imports everything theme-related from
 * this module.
 */
import { bestContrastText, deriveMuted, normalizeHex } from './color';
import {
  COLOR_ROLES,
  CUSTOM_PRESET,
  PRESET_KEYS,
  themeOptions,
  type CardStyle,
  type DefaultView,
  type FontKey,
  type Preset,
  type PresetKey,
  type Theme,
  type ThemeBackground,
  type ThemeColors,
  type ThemeFonts,
} from './themeOptions';

export {
  CARD_STYLE_KEYS,
  COLOR_ROLES,
  CUSTOM_PRESET,
  DEFAULT_VIEW_KEYS,
  FONT_KEYS,
  IMAGE_FIT_KEYS,
  NOTE_COLOR_KEYS,
  PATTERN_KEYS,
  PRESET_KEYS,
  themeOptions,
} from './themeOptions';
export type {
  CardStyle,
  ColorRole,
  DefaultView,
  FontKey,
  FontOption,
  FontSlot,
  ImageFit,
  NoteColorKey,
  NoteColorOption,
  Option,
  PatternKey,
  Preset,
  PresetKey,
  Theme,
  ThemeBackground,
  ThemeColors,
  ThemeFonts,
} from './themeOptions';

export const fontOptions = themeOptions.fonts;
export const patternOptions = themeOptions.patterns;
export const imageFitOptions = themeOptions.imageFits;
export const cardStyleOptions = themeOptions.cardStyles;
export const defaultViewOptions = themeOptions.defaultViews;
export const noteColorOptions = themeOptions.noteColors;
export const noteInk = themeOptions.noteInk;
export const presets = themeOptions.presets;

function cloneTheme(theme: Theme): Theme {
  return {
    preset: theme.preset,
    colors: { ...theme.colors },
    fonts: { ...theme.fonts },
    background: { ...theme.background },
    card_style: theme.card_style,
    default_view: theme.default_view,
  };
}

/**
 * Narrows a string to a preset key.
 *
 * @param value - Any string, e.g. a stored `preset`.
 * @returns Whether `value` is a preset key (`"custom"` is not).
 */
export function isPresetKey(value: string): value is PresetKey {
  const keys: readonly string[] = PRESET_KEYS;
  return keys.includes(value);
}

/**
 * Looks up a preset.
 *
 * @param key - The preset key.
 * @returns The preset (its theme is shared; copy it before changing it).
 */
export function getPreset(key: PresetKey): Preset {
  const preset = presets.find((candidate) => candidate.key === key);
  if (preset === undefined) {
    throw new Error(`Unknown preset "${key}"`);
  }
  return preset;
}

/**
 * Builds the default theme (what logged-out pages and new users get).
 *
 * @returns A fresh copy of the default preset's theme.
 */
export function defaultTheme(): Theme {
  return cloneTheme(getPreset(themeOptions.defaultPreset).theme);
}

/**
 * Applies a preset: replaces colors, fonts, background pattern and card style, and sets `preset`.
 * The background image, its fit and the default view are kept.
 *
 * @param theme - The current theme.
 * @param key - The preset to apply.
 * @returns A new theme.
 */
export function applyPreset(theme: Theme, key: PresetKey): Theme {
  const preset = cloneTheme(getPreset(key).theme);
  return {
    ...preset,
    preset: key,
    background: {
      pattern: preset.background.pattern,
      image_upload_id: theme.background.image_upload_id,
      image_fit: theme.background.image_fit,
    },
    default_view: theme.default_view,
  };
}

/**
 * Marks a theme as no longer matching its preset.
 *
 * @param theme - The theme.
 * @returns A copy with `preset: "custom"`.
 */
export function markCustom(theme: Theme): Theme {
  return { ...cloneTheme(theme), preset: CUSTOM_PRESET };
}

/** A partial change to a theme's editable fields. */
export interface ThemeEdit {
  colors?: Partial<ThemeColors>;
  fonts?: Partial<ThemeFonts>;
  background?: Partial<ThemeBackground>;
  card_style?: CardStyle;
  default_view?: DefaultView;
}

/**
 * Edits one or more theme fields. Any edit sets `preset: "custom"`.
 *
 * @param theme - The current theme.
 * @param edit - The fields to change; nested groups are merged.
 * @returns A new theme.
 */
export function withField(theme: Theme, edit: ThemeEdit): Theme {
  return markCustom({
    preset: theme.preset,
    colors: { ...theme.colors, ...edit.colors },
    fonts: { ...theme.fonts, ...edit.fonts },
    background: { ...theme.background, ...edit.background },
    card_style: edit.card_style ?? theme.card_style,
    default_view: edit.default_view ?? theme.default_view,
  });
}

/**
 * Compares two themes field by field (colors case-insensitively).
 *
 * @param a - A theme.
 * @param b - Another theme.
 * @returns Whether both describe the same theme.
 */
export function themesEqual(a: Theme, b: Theme): boolean {
  const colorsEqual = COLOR_ROLES.every(
    (role) => a.colors[role].toUpperCase() === b.colors[role].toUpperCase(),
  );
  return (
    colorsEqual &&
    a.preset === b.preset &&
    a.fonts.heading === b.fonts.heading &&
    a.fonts.body === b.fonts.body &&
    a.background.pattern === b.background.pattern &&
    a.background.image_upload_id === b.background.image_upload_id &&
    a.background.image_fit === b.background.image_fit &&
    a.card_style === b.card_style &&
    a.default_view === b.default_view
  );
}

/**
 * Resolves a font key to its CSS `font-family` value.
 *
 * @param key - The font key.
 * @returns The family list, including fallbacks.
 */
export function fontFamily(key: FontKey): string {
  const font = fontOptions.find((candidate) => candidate.key === key);
  if (font === undefined) {
    throw new Error(`Unknown font "${key}"`);
  }
  return font.family;
}

/**
 * Builds the URL of an uploaded image.
 *
 * @param id - The upload UUID.
 * @returns The same-origin API URL that serves the image.
 */
export function uploadUrl(id: string): string {
  return `/api/uploads/${encodeURIComponent(id)}`;
}

/** Every `--sotd-*` custom property a theme defines. */
export interface ThemeCssVars {
  '--sotd-bg': string;
  '--sotd-surface': string;
  '--sotd-text': string;
  '--sotd-accent': string;
  '--sotd-border': string;
  '--sotd-muted': string;
  '--sotd-accent-contrast': string;
  '--sotd-font-heading': string;
  '--sotd-font-body': string;
  '--sotd-note-ink': string;
}

/**
 * Maps a theme to its CSS custom properties, including the derived `--sotd-muted` (see
 * {@link deriveMuted}) and `--sotd-accent-contrast` (black or white, whichever contrasts more
 * with the accent).
 *
 * @param theme - The theme.
 * @returns The variables, with colors as upper-case `#RRGGBB`.
 */
export function themeToCssVars(theme: Theme): ThemeCssVars {
  const { background, surface, text, accent, border } = theme.colors;
  return {
    '--sotd-bg': normalizeHex(background),
    '--sotd-surface': normalizeHex(surface),
    '--sotd-text': normalizeHex(text),
    '--sotd-accent': normalizeHex(accent),
    '--sotd-border': normalizeHex(border),
    '--sotd-muted': deriveMuted(text, surface),
    '--sotd-accent-contrast': bestContrastText(accent),
    '--sotd-font-heading': fontFamily(theme.fonts.heading),
    '--sotd-font-body': fontFamily(theme.fonts.body),
    '--sotd-note-ink': noteInk,
  };
}
