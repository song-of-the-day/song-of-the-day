/**
 * Month bounds and keyboard focus movement for the calendar grid (a roving tab stop over the
 * days that can be opened or logged).
 */
import { addDaysIso } from '@/lib/dates';

/** The earliest month that can hold entries (`entry_date >= 1900-01-01`). */
export const MIN_MONTH = '1900-01';
/** The last month a four-digit `yyyy-MM` key can name. */
export const MAX_MONTH = '9999-12';

const KEY_OFFSETS: Readonly<Partial<Record<string, number>>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

/**
 * Picks the day that takes the grid's tab stop when focus enters it.
 *
 * @param focusable - The month's focusable days in order.
 * @param today - Today's date.
 * @returns Today when focusable, else the first focusable day, or `null` when there is none.
 */
export function initialFocusDate(focusable: readonly string[], today: string): string | null {
  return focusable.includes(today) ? today : (focusable[0] ?? null);
}

/**
 * Moves focus for a key press: the arrows move by a day or a week, Home and End jump to the
 * first and last focusable day. Moves onto a day that isn't focusable (outside the month, or in
 * the future) are ignored.
 *
 * @param key - `KeyboardEvent.key`.
 * @param from - The focused day.
 * @param focusable - The month's focusable days in order.
 * @returns The day to focus, or `null` when the key doesn't move focus.
 */
export function nextFocusDate(
  key: string,
  from: string,
  focusable: readonly string[],
): string | null {
  if (key === 'Home') {
    return focusable[0] ?? null;
  }
  if (key === 'End') {
    return focusable.at(-1) ?? null;
  }
  const offset = KEY_OFFSETS[key];
  if (offset === undefined) {
    return null;
  }
  const target = addDaysIso(from, offset);
  return focusable.includes(target) ? target : null;
}
