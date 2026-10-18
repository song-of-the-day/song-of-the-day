import { describe, expect, it } from 'vitest';

import { defaultTheme, themeToCssVars } from '@/lib/theme';

import tokensCss from './tokens.css?raw';

function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  const end = css.indexOf('}', start);
  if (start === -1 || end === -1) {
    throw new Error(`No "${selector}" block in tokens.css`);
  }
  return css.slice(start + selector.length + 2, end);
}

/** Collapses whitespace and lower-cases hex colors (Prettier prints them lower-case). */
function normalizeValue(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/#[0-9A-Fa-f]{3,8}\b/g, (hex) => hex.toLowerCase());
}

function declarations(body: string): Record<string, string> {
  return Object.fromEntries(
    body
      .split(';')
      .map((declaration) => declaration.trim())
      .filter((declaration) => declaration.startsWith('--'))
      .map((declaration) => {
        const colon = declaration.indexOf(':');
        return [declaration.slice(0, colon).trim(), normalizeValue(declaration.slice(colon + 1))];
      }),
  );
}

describe('tokens.css', () => {
  it('defines :root defaults equal to themeToCssVars(defaultTheme())', () => {
    const rootVars = declarations(block(tokensCss, ':root'));
    const vars: Record<string, string> = { ...themeToCssVars(defaultTheme()) };
    const expected = Object.fromEntries(
      Object.entries(vars).map(([name, value]) => [name, normalizeValue(value)]),
    );
    expect(rootVars).toEqual(expected);
  });

  it('maps every Tailwind token to a --sotd-* variable with @theme inline', () => {
    expect(declarations(block(tokensCss, '@theme inline'))).toEqual({
      '--color-bg': 'var(--sotd-bg)',
      '--color-surface': 'var(--sotd-surface)',
      '--color-fg': 'var(--sotd-text)',
      '--color-accent': 'var(--sotd-accent)',
      '--color-line': 'var(--sotd-border)',
      '--color-muted': 'var(--sotd-muted)',
      '--color-accent-contrast': 'var(--sotd-accent-contrast)',
      '--font-heading': 'var(--sotd-font-heading)',
      '--font-body': 'var(--sotd-font-body)',
    });
  });
});
