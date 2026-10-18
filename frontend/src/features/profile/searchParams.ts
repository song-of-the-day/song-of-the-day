/**
 * Search parameters of `/profile`: `view`, `month` and `entry`.
 */
import { MIN_MONTH } from '@/features/calendar/calendarNavigation';
import { parseMonthKey } from '@/lib/dates';
import { DEFAULT_VIEW_KEYS, type DefaultView } from '@/lib/theme';

/** `?entry=<id>` opens that entry's dialog. */
export const ENTRY_PARAM = 'entry';
/** `?view=board|calendar` picks the main view (default: the theme's `default_view`). */
export const VIEW_PARAM = 'view';
/** `?month=YYYY-MM` picks the calendar's month (default: the current month). */
export const MONTH_PARAM = 'month';

/**
 * Reads the `?entry=<id>` search parameter.
 *
 * @param value - The raw parameter.
 * @returns A positive integer id, or `null` when absent or malformed.
 */
export function parseEntryParam(value: string | null): number | null {
  if (value === null || !/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * Reads the `?view=` search parameter.
 *
 * @param value - The raw parameter.
 * @returns The view, or `null` when absent or unknown.
 */
export function parseViewParam(value: string | null): DefaultView | null {
  return DEFAULT_VIEW_KEYS.find((view) => view === value) ?? null;
}

/**
 * Reads the `?month=` search parameter.
 *
 * @param value - The raw parameter.
 * @returns A real `yyyy-MM` month from {@link MIN_MONTH} on, or `null` when absent or invalid.
 */
export function parseMonthParam(value: string | null): string | null {
  if (value === null || parseMonthKey(value) === null || value < MIN_MONTH) {
    return null;
  }
  return value;
}
