/**
 * Copy shown by the log dialog.
 */
import { formatDisplayDate, formatFullDate } from '@/lib/dates';

export const SEARCH_UNAVAILABLE_MESSAGE =
  'Search is unavailable right now. Enter the song manually.';

/**
 * Names a day in the dialog's copy, adding the year when it isn't this year.
 *
 * @param date - A `yyyy-MM-dd` date.
 * @param today - Today's date.
 * @returns E.g. "Sun, Oct 11", or "Monday, March 3, 2025" for another year.
 */
export function describeDay(date: string, today: string): string {
  return date.slice(0, 4) === today.slice(0, 4) ? formatDisplayDate(date) : formatFullDate(date);
}

/**
 * Warns that annotations survive a song change.
 *
 * @param count - The entry's annotation count (> 0).
 * @returns E.g. "Your 3 notes stay attached; their timestamps were for the previous song."
 */
export function notesStayAttachedMessage(count: number): string {
  return count === 1
    ? 'Your 1 note stays attached; its timestamp was for the previous song.'
    : `Your ${String(count)} notes stay attached; their timestamps were for the previous song.`;
}

/**
 * Explains a `409 entry_exists`.
 *
 * @param title - The logged song's title, or `undefined` while it loads.
 * @param day - The day, as {@link describeDay} names it.
 * @returns E.g. "You already logged Gosh for Sun, Oct 11."
 */
export function alreadyLoggedMessage(title: string | undefined, day: string): string {
  return title === undefined
    ? `You already logged a song for ${day}.`
    : `You already logged ${title} for ${day}.`;
}
