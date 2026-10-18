import { describe, expect, it } from 'vitest';

import type { ContrastIssue } from '@/lib/color';

import { describeContrastIssue, formatRatio } from './contrast';

function issue(overrides: Partial<ContrastIssue>): ContrastIssue {
  return {
    pair: 'text-surface',
    label: 'Text on surface',
    foreground: '#777777',
    background: '#888888',
    ratio: 2.14,
    minimum: 4.5,
    ...overrides,
  };
}

describe('contrast copy', () => {
  it('rounds ratios down so a near miss never reads as passing', () => {
    expect(formatRatio(4.49)).toBe('4.4:1');
    expect(formatRatio(1)).toBe('1.0:1');
    expect(formatRatio(2.96)).toBe('2.9:1');
  });

  it.each([
    ['text-surface', 4.5, 'Text on cards is hard to read (2.1:1, needs 4.5:1)'],
    ['muted-surface', 4.5, 'Secondary text on cards is hard to read (2.1:1, needs 4.5:1)'],
    ['accent-surface', 3, 'The accent color is hard to see on cards (2.1:1, needs 3:1)'],
    [
      'accent-contrast',
      4.5,
      'Button labels on the accent color are hard to read (2.1:1, needs 4.5:1)',
    ],
  ] as const)('describes %s', (pair, minimum, message) => {
    expect(describeContrastIssue(issue({ pair, minimum }))).toBe(message);
  });
});
