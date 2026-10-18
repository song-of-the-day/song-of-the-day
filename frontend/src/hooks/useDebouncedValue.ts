/**
 * Debouncing for fast-changing values such as search input.
 */
import { useEffect, useState } from 'react';

/** Default debounce delay for search input. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Returns `value` once it has stopped changing for `delayMs`.
 *
 * @param value - The live value.
 * @param delayMs - The quiet period before the value is passed through.
 * @returns The debounced value (initially `value`).
 */
export function useDebouncedValue<T>(value: T, delayMs: number = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);
  return debounced;
}
