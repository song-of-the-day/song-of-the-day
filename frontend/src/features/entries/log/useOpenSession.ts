/**
 * Numbers the times a controlled dialog has been opened.
 */
import { useState } from 'react';

/**
 * Counts how often `open` has become `true`. Use it as the `key` of a dialog's stateful body so
 * every opening starts fresh, while a closed dialog keeps its state until it opens again (its
 * content is unmounted anyway).
 *
 * @param open - The dialog's `open` prop.
 * @returns The current session number (starts at 0, or 1 when initially open).
 */
export function useOpenSession(open: boolean): number {
  const [state, setState] = useState(() => ({ open, session: open ? 1 : 0 }));
  if (state.open !== open) {
    const next = { open, session: open ? state.session + 1 : state.session };
    setState(next);
    return next.session;
  }
  return state.session;
}
