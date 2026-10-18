/**
 * Conversions between song positions in milliseconds and `m:ss` / `h:mm:ss` text.
 */

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const DIGITS = /^\d+$/;

/**
 * Formats a position within a song.
 *
 * @param ms - Milliseconds; negative values count as 0 and fractions of a second are dropped.
 * @returns `m:ss` below one hour, otherwise `h:mm:ss`.
 */
export function formatMs(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / MS_PER_SECOND);
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = String(totalSeconds % SECONDS_PER_MINUTE).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`;
  }
  return `${minutes}:${seconds}`;
}

/**
 * Parses a typed timestamp: `"83"` (seconds), `"1:23"` (m:ss) or `"01:02:03"` (h:mm:ss).
 * Surrounding whitespace is ignored. In the colon forms, seconds (and minutes after hours) must
 * be below 60.
 *
 * @param input - The text to parse.
 * @returns The position in milliseconds, or `null` when the text is not a timestamp.
 */
export function parseTimestamp(input: string): number | null {
  const parts = input.trim().split(':');
  if (parts.length > 3 || !parts.every((part) => DIGITS.test(part))) {
    return null;
  }
  const values = parts.map(Number);
  const [first = 0, second = 0, third = 0] = values;
  let seconds: number;
  if (values.length === 1) {
    seconds = first;
  } else if (values.length === 2) {
    if (second >= SECONDS_PER_MINUTE) {
      return null;
    }
    seconds = first * SECONDS_PER_MINUTE + second;
  } else {
    if (second >= SECONDS_PER_MINUTE || third >= SECONDS_PER_MINUTE) {
      return null;
    }
    seconds = first * SECONDS_PER_HOUR + second * SECONDS_PER_MINUTE + third;
  }
  return seconds * MS_PER_SECOND;
}
