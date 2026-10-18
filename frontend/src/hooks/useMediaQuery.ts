/**
 * Subscribes to a CSS media query.
 */
import { useCallback, useSyncExternalStore } from 'react';

/** Tailwind's `sm` breakpoint (40rem = 640px): dialogs and sheets switch layout here. */
export const WIDE_VIEWPORT_QUERY = '(min-width: 40rem)';

/**
 * Tracks whether a media query matches, re-rendering when it changes.
 *
 * @param query - A media query, e.g. {@link WIDE_VIEWPORT_QUERY}.
 * @returns Whether the query currently matches (`false` when rendering without a DOM).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
