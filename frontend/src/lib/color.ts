/**
 * Hex color helpers and WCAG 2.1 contrast math used by theming and the contrast checker.
 *
 * Colors are exchanged as hex strings; outputs are always upper-case `#RRGGBB`.
 */
import type { Theme } from './themeOptions';

/** A color as 8-bit sRGB channels. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const STRICT_HEX = /^#[0-9A-Fa-f]{6}$/;
const LOOSE_HEX = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

export const BLACK = '#000000';
export const WHITE = '#FFFFFF';

/**
 * Checks the API's color format.
 *
 * @param value - Any string.
 * @returns Whether `value` is a `#RRGGBB` color (case-insensitive).
 */
export function isHexColor(value: string): boolean {
  return STRICT_HEX.test(value);
}

/**
 * Parses `#RGB` or `#RRGGBB` (case-insensitive).
 *
 * @param value - The hex string.
 * @returns The channels, or `null` when `value` is not a hex color.
 */
export function parseHex(value: string): Rgb | null {
  if (!LOOSE_HEX.test(value)) {
    return null;
  }
  const digits = value.length === 4 ? value.slice(1).replace(/./g, '$&$&') : value.slice(1);
  return {
    r: Number.parseInt(digits.slice(0, 2), 16),
    g: Number.parseInt(digits.slice(2, 4), 16),
    b: Number.parseInt(digits.slice(4, 6), 16),
  };
}

function channelHex(channel: number): string {
  const clamped = Math.min(255, Math.max(0, Math.round(channel)));
  return clamped.toString(16).padStart(2, '0');
}

/**
 * Formats channels as hex, rounding and clamping each to 0–255.
 *
 * @param rgb - The channels.
 * @returns An upper-case `#RRGGBB` string.
 */
export function formatHex({ r, g, b }: Rgb): string {
  return `#${channelHex(r)}${channelHex(g)}${channelHex(b)}`.toUpperCase();
}

function toRgb(value: string): Rgb {
  const rgb = parseHex(value);
  if (rgb === null) {
    throw new Error(`Invalid hex color: "${value}"`);
  }
  return rgb;
}

/**
 * Normalizes a hex color.
 *
 * @param value - A `#RGB` or `#RRGGBB` string.
 * @returns The same color as upper-case `#RRGGBB`.
 * @throws Error if `value` is not a hex color.
 */
export function normalizeHex(value: string): string {
  return formatHex(toRgb(value));
}

function linearize(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/**
 * Computes WCAG 2.1 relative luminance.
 *
 * @param color - A hex color.
 * @returns Luminance from 0 (black) to 1 (white).
 * @throws Error if `color` is not a hex color.
 */
export function relativeLuminance(color: string): number {
  const { r, g, b } = toRgb(color);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Computes the WCAG 2.1 contrast ratio between two colors (order does not matter).
 *
 * @param a - A hex color.
 * @param b - Another hex color.
 * @returns A ratio from 1 to 21.
 * @throws Error if either color is not a hex color.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Mixes two colors in sRGB space.
 *
 * @param from - The starting hex color.
 * @param to - The hex color to mix toward.
 * @param amount - How far to move toward `to`, clamped to 0–1 (0 returns `from`).
 * @returns The mixed color as `#RRGGBB`.
 * @throws Error if either color is not a hex color.
 */
export function mix(from: string, to: string, amount: number): string {
  const a = toRgb(from);
  const b = toRgb(to);
  const t = Math.min(1, Math.max(0, amount));
  return formatHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

/**
 * Picks black or white text for a background, whichever contrasts more (black on a tie).
 *
 * @param background - A hex color.
 * @returns `#000000` or `#FFFFFF`.
 */
export function bestContrastText(background: string): typeof BLACK | typeof WHITE {
  return contrastRatio(WHITE, background) > contrastRatio(BLACK, background) ? WHITE : BLACK;
}

/** Minimum contrast for body text (WCAG 2.1 AA). */
export const TEXT_CONTRAST = 4.5;
/** Minimum contrast for UI components and large graphics (WCAG 2.1 AA). */
export const UI_CONTRAST = 3;
const MUTED_START_PERCENT = 35;

/**
 * Derives the muted text color: `text` mixed 35% toward `surface`, stepped back toward `text`
 * one percent at a time until it reaches 4.5:1 on `surface`.
 *
 * @param text - The theme text color.
 * @param surface - The theme surface color.
 * @returns The muted color, or `text` itself when no mix reaches 4.5:1.
 */
export function deriveMuted(text: string, surface: string): string {
  for (let percent = MUTED_START_PERCENT; percent > 0; percent -= 1) {
    const candidate = mix(text, surface, percent / 100);
    if (contrastRatio(candidate, surface) >= TEXT_CONTRAST) {
      return candidate;
    }
  }
  return normalizeHex(text);
}

export type ContrastPair = 'text-surface' | 'muted-surface' | 'accent-surface' | 'accent-contrast';

/** One color pair that fails its minimum contrast. */
export interface ContrastIssue {
  pair: ContrastPair;
  /** Human-readable name of the pair, e.g. "Text on surface". */
  label: string;
  foreground: string;
  background: string;
  ratio: number;
  minimum: number;
}

/**
 * Checks the theme's color pairs against WCAG 2.1 minimums: text/surface and muted/surface
 * ≥ 4.5:1, accent/surface ≥ 3:1, accent-contrast/accent ≥ 4.5:1.
 *
 * @param theme - The theme to check.
 * @returns The failing pairs, in the order above (empty when all pass).
 */
export function checkThemeContrast(theme: Theme): ContrastIssue[] {
  const { text, surface, accent } = theme.colors;
  const pairs: Omit<ContrastIssue, 'ratio'>[] = [
    {
      pair: 'text-surface',
      label: 'Text on surface',
      foreground: text,
      background: surface,
      minimum: TEXT_CONTRAST,
    },
    {
      pair: 'muted-surface',
      label: 'Muted text on surface',
      foreground: deriveMuted(text, surface),
      background: surface,
      minimum: TEXT_CONTRAST,
    },
    {
      pair: 'accent-surface',
      label: 'Accent on surface',
      foreground: accent,
      background: surface,
      minimum: UI_CONTRAST,
    },
    {
      pair: 'accent-contrast',
      label: 'Text on accent',
      foreground: bestContrastText(accent),
      background: accent,
      minimum: TEXT_CONTRAST,
    },
  ];
  return pairs
    .map((pair) => ({ ...pair, ratio: contrastRatio(pair.foreground, pair.background) }))
    .filter((issue) => issue.ratio < issue.minimum);
}
