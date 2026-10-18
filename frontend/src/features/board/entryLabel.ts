/**
 * Accessible names for controls that open an entry (board cards and calendar days).
 */
import type { Entry } from '@/api/types';
import { formatFullDate, isIsoDate } from '@/lib/dates';

/**
 * Formats a date for an accessible name, keeping a malformed value as given (so one bad row
 * can't break a whole view).
 *
 * @param date - A `yyyy-MM-dd` date.
 * @returns E.g. "Sunday, October 11, 2026".
 */
export function spokenDate(date: string): string {
  return isIsoDate(date) ? formatFullDate(date) : date;
}

/**
 * Names the control that opens an entry.
 *
 * @param entry - The entry's title, artist and date.
 * @returns E.g. "Open Gosh by Jamie xx, Sunday, October 11, 2026".
 */
export function openEntryLabel(entry: Pick<Entry, 'title' | 'artist' | 'entry_date'>): string {
  return `Open ${entry.title} by ${entry.artist}, ${spokenDate(entry.entry_date)}`;
}

/**
 * Counts an entry's annotations in words.
 *
 * @param count - The number of annotations.
 * @returns E.g. "1 note" or "3 notes".
 */
export function notesLabel(count: number): string {
  return `${String(count)} ${count === 1 ? 'note' : 'notes'}`;
}
