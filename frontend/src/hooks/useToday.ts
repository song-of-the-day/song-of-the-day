/**
 * The browser's local date, kept current across midnight and tab switches.
 */
import { useSyncExternalStore } from 'react';

import { localToday, msUntilNextLocalMidnight } from '@/lib/dates';

/** Fire the midnight timer slightly late so the new date has certainly begun. */
const MIDNIGHT_SLACK_MS = 1000;

function subscribe(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleMidnight = (): void => {
    timer = setTimeout(() => {
      onChange();
      scheduleMidnight();
    }, msUntilNextLocalMidnight() + MIDNIGHT_SLACK_MS);
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      onChange();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', onChange);
  scheduleMidnight();
  return () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', onChange);
  };
}

/**
 * Returns today's local date. It is re-read when the tab becomes visible, when the window gains
 * focus and at the next local midnight.
 *
 * @returns Today as `yyyy-MM-dd`.
 */
export function useToday(): string {
  return useSyncExternalStore(subscribe, localToday);
}
