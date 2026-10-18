/**
 * Calendar-date helpers. Dates are exchanged as ISO `yyyy-MM-dd` strings in the browser's local
 * time zone (the API stores calendar dates; the client decides what "today" is). Months are
 * `yyyy-MM` keys, as in the `?month=` search parameter.
 */
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  format,
  getDay,
  getDaysInMonth,
  isValid,
  parse,
  startOfDay,
} from 'date-fns';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY = /^\d{4}-\d{2}$/;
const DAYS_PER_WEEK = 7;

/** A month as weeks (Sunday first) of ISO dates; days outside the month are `null`. */
export type MonthGrid = (string | null)[][];

/**
 * Formats a `Date` as its local calendar date.
 *
 * @param date - Any date.
 * @returns The local `yyyy-MM-dd`.
 */
export function toIsoDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Returns the browser's local calendar date.
 *
 * @param now - The current time (injectable for tests).
 * @returns Today as `yyyy-MM-dd`.
 */
export function localToday(now: Date = new Date()): string {
  return toIsoDate(now);
}

/**
 * Parses a strict ISO calendar date.
 *
 * @param value - Text such as `"2026-10-11"`.
 * @returns Local midnight of that day, or `null` if `value` is not a real `yyyy-MM-dd` date.
 */
export function parseIsoDate(value: string): Date | null {
  if (!ISO_DATE.test(value)) {
    return null;
  }
  const date = parse(value, 'yyyy-MM-dd', new Date(0));
  return isValid(date) && toIsoDate(date) === value ? date : null;
}

/**
 * Checks whether a string is a real `yyyy-MM-dd` date.
 *
 * @param value - Any string.
 * @returns `true` for valid dates such as `"2024-02-29"`, `false` for `"2026-02-30"`.
 */
export function isIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

function requireIsoDate(value: string): Date {
  const date = parseIsoDate(value);
  if (date === null) {
    throw new Error(`Invalid ISO date: "${value}"`);
  }
  return date;
}

/**
 * Shifts a calendar date.
 *
 * @param value - A `yyyy-MM-dd` date.
 * @param days - Days to add (negative to subtract).
 * @returns The shifted `yyyy-MM-dd` date.
 * @throws Error if `value` is not a valid date.
 */
export function addDaysIso(value: string, days: number): string {
  return toIsoDate(addDays(requireIsoDate(value), days));
}

/**
 * Counts the days in an inclusive range.
 *
 * @param start - The first `yyyy-MM-dd` day.
 * @param end - The last `yyyy-MM-dd` day.
 * @returns The number of days from `start` through `end` (1 when equal, ≤ 0 when reversed).
 * @throws Error if either value is not a valid date.
 */
export function daysInRange(start: string, end: string): number {
  return differenceInCalendarDays(requireIsoDate(end), requireIsoDate(start)) + 1;
}

/**
 * Checks whether a date is in the future (and therefore cannot be logged).
 *
 * @param value - A `yyyy-MM-dd` date.
 * @param today - Today's `yyyy-MM-dd` date.
 * @returns Whether `value` is after `today`.
 */
export function isAfterToday(value: string, today: string): boolean {
  return value > today;
}

/**
 * Gets the month key of a date.
 *
 * @param value - A `yyyy-MM-dd` date string or a `Date`.
 * @returns The `yyyy-MM` month key.
 */
export function monthKeyOf(value: string | Date): string {
  return typeof value === 'string' ? value.slice(0, 7) : format(value, 'yyyy-MM');
}

/**
 * Parses a month key.
 *
 * @param value - Text such as `"2026-10"`.
 * @returns Local midnight on the first of that month, or `null` if `value` is not a valid key.
 */
export function parseMonthKey(value: string): Date | null {
  return MONTH_KEY.test(value) ? parseIsoDate(`${value}-01`) : null;
}

function requireMonthKey(value: string): Date {
  const date = parseMonthKey(value);
  if (date === null) {
    throw new Error(`Invalid month key: "${value}"`);
  }
  return date;
}

/**
 * Shifts a month key.
 *
 * @param monthKey - A `yyyy-MM` key.
 * @param months - Months to add (negative to subtract).
 * @returns The shifted `yyyy-MM` key.
 * @throws Error if `monthKey` is not valid.
 */
export function addMonthsKey(monthKey: string, months: number): string {
  return format(addMonths(requireMonthKey(monthKey), months), 'yyyy-MM');
}

/**
 * Gets the first and last day of a month, as used by `GET /api/entries?start=…&end=…`.
 *
 * @param monthKey - A `yyyy-MM` key.
 * @returns The inclusive `yyyy-MM-dd` bounds.
 * @throws Error if `monthKey` is not valid.
 */
export function monthRange(monthKey: string): { start: string; end: string } {
  const first = requireMonthKey(monthKey);
  return {
    start: toIsoDate(first),
    end: toIsoDate(addDays(first, getDaysInMonth(first) - 1)),
  };
}

/**
 * Lays out a month as calendar weeks starting on Sunday.
 *
 * @param monthKey - A `yyyy-MM` key.
 * @returns 4–6 weeks of 7 cells; days outside the month are `null`.
 * @throws Error if `monthKey` is not valid.
 */
export function monthGrid(monthKey: string): MonthGrid {
  const first = requireMonthKey(monthKey);
  const days = Array.from({ length: getDaysInMonth(first) }, (_, index) =>
    toIsoDate(addDays(first, index)),
  );
  const cells: (string | null)[] = [...Array<null>(getDay(first)).fill(null), ...days];
  while (cells.length % DAYS_PER_WEEK !== 0) {
    cells.push(null);
  }
  const weeks: MonthGrid = [];
  for (let index = 0; index < cells.length; index += DAYS_PER_WEEK) {
    weeks.push(cells.slice(index, index + DAYS_PER_WEEK));
  }
  return weeks;
}

/**
 * Formats a date for headings and messages, e.g. "Sun, Oct 11".
 *
 * @param value - A `yyyy-MM-dd` date.
 * @returns The short display form.
 * @throws Error if `value` is not a valid date.
 */
export function formatDisplayDate(value: string): string {
  return format(requireIsoDate(value), 'EEE, MMM d');
}

/**
 * Formats a date in full, e.g. "Sunday, October 11, 2026" (for accessible labels).
 *
 * @param value - A `yyyy-MM-dd` date.
 * @returns The long display form.
 * @throws Error if `value` is not a valid date.
 */
export function formatFullDate(value: string): string {
  return format(requireIsoDate(value), 'EEEE, MMMM d, yyyy');
}

/**
 * Formats a month title, e.g. "October 2026".
 *
 * @param monthKey - A `yyyy-MM` key.
 * @returns The month name and year.
 * @throws Error if `monthKey` is not valid.
 */
export function formatMonthTitle(monthKey: string): string {
  return format(requireMonthKey(monthKey), 'MMMM yyyy');
}

/**
 * Measures the time until the local date changes.
 *
 * @param now - The current time (injectable for tests).
 * @returns Milliseconds until the next local midnight (always > 0).
 */
export function msUntilNextLocalMidnight(now: Date = new Date()): number {
  return addDays(startOfDay(now), 1).getTime() - now.getTime();
}
