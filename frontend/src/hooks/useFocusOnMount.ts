/**
 * Moves keyboard focus to an element when it appears.
 */
import { useEffect, useRef, type RefObject } from 'react';

/**
 * Focuses the referenced element once, after it mounts. Use it when a view replaces the one
 * that had focus (e.g. a form swapped for its confirmation), so keyboard and screen-reader users
 * land on the new content. Give the element `tabIndex={-1}` if it isn't focusable.
 *
 * @returns A ref to attach to the element.
 */
export function useFocusOnMount<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}
