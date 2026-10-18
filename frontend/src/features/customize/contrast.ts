/**
 * Plain-language contrast warnings for the customize sheet.
 */
import type { ContrastIssue, ContrastPair } from '@/lib/color';

const PROBLEMS: Record<ContrastPair, string> = {
  'text-surface': 'Text on cards is hard to read',
  'muted-surface': 'Secondary text on cards is hard to read',
  'accent-surface': 'The accent color is hard to see on cards',
  'accent-contrast': 'Button labels on the accent color are hard to read',
};

/**
 * Formats a contrast ratio, rounded down so a near miss never reads as passing.
 *
 * @param ratio - The measured ratio, e.g. 4.47.
 * @returns E.g. "4.4:1".
 */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1`;
}

/**
 * Describes a failing color pair.
 *
 * @param issue - A result of `checkThemeContrast`.
 * @returns E.g. "Text on cards is hard to read (2.1:1, needs 4.5:1)".
 */
export function describeContrastIssue(issue: ContrastIssue): string {
  return `${PROBLEMS[issue.pair]} (${formatRatio(issue.ratio)}, needs ${String(issue.minimum)}:1)`;
}
