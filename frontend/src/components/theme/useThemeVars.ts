/**
 * Applies a theme to the whole document.
 */
import { useLayoutEffect, useMemo } from 'react';

import { relativeLuminance } from '@/lib/color';
import { themeToCssVars, type Theme } from '@/lib/theme';

/** Surfaces darker than this get `color-scheme: dark` (native controls, scrollbars). */
const DARK_SURFACE_LUMINANCE = 0.2;

/**
 * Picks the native color scheme matching a theme, so form controls, date pickers and
 * scrollbars aren't light on a dark theme.
 *
 * @param theme - The theme.
 * @returns `"dark"` for a dark surface, otherwise `"light"`.
 */
export function colorSchemeOf(theme: Theme): 'light' | 'dark' {
  return relativeLuminance(theme.colors.surface) < DARK_SURFACE_LUMINANCE ? 'dark' : 'light';
}

/**
 * Sets the theme's `--sotd-*` variables (and `color-scheme`) on `<html>` while mounted, so
 * dialogs and sheets portaled to `<body>` inherit them too. The previous values are restored
 * when the theme changes or the component unmounts, which falls back to the `:root` defaults
 * in `tokens.css`.
 *
 * Mount one at a time (the profile page owns the theme): when calls are nested, React runs the
 * child's effect first, so the outer theme would win.
 *
 * @param theme - The theme to apply, or `null` to keep the defaults.
 */
export function useThemeVars(theme: Theme | null): void {
  const properties = useMemo(
    () =>
      theme === null ? null : { ...themeToCssVars(theme), 'color-scheme': colorSchemeOf(theme) },
    [theme],
  );

  useLayoutEffect(() => {
    if (properties === null) {
      return undefined;
    }
    const { style } = document.documentElement;
    const previous = Object.keys(properties).map(
      (name) => [name, style.getPropertyValue(name)] as const,
    );
    for (const [name, value] of Object.entries(properties)) {
      style.setProperty(name, value);
    }
    return () => {
      for (const [name, value] of previous) {
        if (value === '') {
          style.removeProperty(name);
        } else {
          style.setProperty(name, value);
        }
      }
    };
  }, [properties]);
}
