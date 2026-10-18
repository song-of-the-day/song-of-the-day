/**
 * Runs a callback when an element scrolls into (or near) the viewport.
 */
import { useEffect, useEffectEvent, useState, type RefCallback } from 'react';

/** Start loading before the sentinel is actually on screen. */
const DEFAULT_ROOT_MARGIN = '600px';

/**
 * Watches an element with an `IntersectionObserver` and calls `onVisible` while it is near the
 * viewport. The observer is recreated whenever `enabled` turns on again, which reports the
 * current state at once: a sentinel that is still visible after a page loads fires again.
 *
 * @param onVisible - Called when the element is within `rootMargin` of the viewport.
 * @param enabled - Whether to watch at all (e.g. there is more to load and nothing is loading).
 * @param rootMargin - How far outside the viewport counts as visible.
 * @returns A ref callback for the element to watch.
 */
export function useWhenVisible<T extends Element>(
  onVisible: () => void,
  enabled: boolean,
  rootMargin: string = DEFAULT_ROOT_MARGIN,
): RefCallback<T> {
  const [element, setElement] = useState<T | null>(null);
  const handleVisible = useEffectEvent(onVisible);

  useEffect(() => {
    if (!enabled || element === null) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) {
          handleVisible();
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [enabled, element, rootMargin]);

  return setElement;
}
