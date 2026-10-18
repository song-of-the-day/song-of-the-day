/**
 * jsdom doesn't run Tailwind (CSS is stubbed in tests), so a `bg-surface` element's computed
 * style can't be checked here. Instead these tests check the `--sotd-*` variables on `<html>`,
 * which `@theme inline` utilities read (tokens.test.ts verifies that mapping).
 */
import { render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { applyPreset, defaultTheme, themeToCssVars, withField, type Theme } from '@/lib/theme';
import { makeTheme } from '@/test/fixtures';

import { colorSchemeOf, useThemeVars } from './useThemeVars';

const root = document.documentElement;

function cssVar(name: string): string {
  return root.style.getPropertyValue(name);
}

const midnight = applyPreset(defaultTheme(), 'midnight-crt');

describe('colorSchemeOf', () => {
  it('is dark for dark surfaces and light otherwise', () => {
    expect(colorSchemeOf(midnight)).toBe('dark');
    expect(colorSchemeOf(defaultTheme())).toBe('light');
  });
});

describe('useThemeVars', () => {
  afterEach(() => {
    root.removeAttribute('style');
  });

  it('sets every theme variable and the color scheme on <html>', () => {
    renderHook(() => {
      useThemeVars(midnight);
    });

    for (const [name, value] of Object.entries(themeToCssVars(midnight))) {
      expect(cssVar(name)).toBe(value);
    }
    expect(cssVar('--sotd-surface')).toBe('#0E141B');
    expect(cssVar('--sotd-font-heading')).toContain('VT323');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('makes a themed surface resolve to the theme surface for portaled content', () => {
    const theme = makeTheme({ colors: { surface: '#FFF7FB' } });
    renderHook(() => {
      useThemeVars(theme);
    });
    const portaled = document.createElement('div');
    portaled.className = 'bg-surface';
    document.body.append(portaled);

    expect(getComputedStyle(portaled).getPropertyValue('--sotd-surface')).toBe('#FFF7FB');
    portaled.remove();
  });

  it('switches variables when the theme changes', () => {
    const { rerender } = renderHook(
      ({ theme }: { theme: Theme }) => {
        useThemeVars(theme);
      },
      { initialProps: { theme: midnight } },
    );

    const edited = withField(midnight, { colors: { accent: '#FF00AA' } });
    rerender({ theme: edited });

    expect(cssVar('--sotd-accent')).toBe('#FF00AA');
    expect(cssVar('--sotd-surface')).toBe('#0E141B');
  });

  it('restores the defaults on unmount', () => {
    const { unmount } = renderHook(() => {
      useThemeVars(midnight);
    });

    unmount();

    expect(cssVar('--sotd-bg')).toBe('');
    expect(cssVar('--sotd-muted')).toBe('');
    expect(root.style.colorScheme).toBe('');
  });

  it('hands over cleanly when one themed page replaces another', () => {
    function Themed({ theme }: { theme: Theme }) {
      useThemeVars(theme);
      return null;
    }

    const { rerender, unmount } = render(<Themed key="a" theme={midnight} />);
    expect(cssVar('--sotd-bg')).toBe('#07090C');

    rerender(<Themed key="b" theme={defaultTheme()} />);
    expect(cssVar('--sotd-bg')).toBe('#E8E6F0');
    expect(root.style.colorScheme).toBe('light');

    unmount();
    expect(cssVar('--sotd-bg')).toBe('');
  });

  it('restores values that were set before it mounted', () => {
    root.style.setProperty('--sotd-accent', '#123456');
    const { unmount } = renderHook(() => {
      useThemeVars(midnight);
    });
    expect(cssVar('--sotd-accent')).toBe('#33FF85');

    unmount();

    expect(cssVar('--sotd-accent')).toBe('#123456');
    expect(cssVar('--sotd-bg')).toBe('');
  });

  it('keeps the defaults for a null theme', () => {
    renderHook(() => {
      useThemeVars(null);
    });

    expect(root.style).toHaveLength(0);
  });
});
