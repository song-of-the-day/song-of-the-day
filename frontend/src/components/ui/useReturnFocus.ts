/**
 * Focus return for controlled Radix dialogs.
 */
import { useRef } from 'react';

type AutoFocusHandler = (event: Event) => void;

export interface ReturnFocusHandlers {
  onOpenAutoFocus: AutoFocusHandler;
  onCloseAutoFocus: AutoFocusHandler;
}

/**
 * Returns focus to whatever was focused when a dialog opened. Radix only restores focus to a
 * `Dialog.Trigger`; our dialogs are controlled and opened from arbitrary buttons, so without this
 * focus would fall back to `<body>` on close.
 *
 * @param onOpenAutoFocus - The caller's handler, run after the opener is recorded.
 * @param onCloseAutoFocus - The caller's handler; if it calls `preventDefault()`, focus is left
 *   to the caller.
 * @returns Handlers for Radix `Dialog.Content`.
 */
export function useReturnFocus(
  onOpenAutoFocus?: AutoFocusHandler,
  onCloseAutoFocus?: AutoFocusHandler,
): ReturnFocusHandlers {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event) => {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event) => {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      const target = opener.current;
      opener.current = null;
      if (target?.isConnected) {
        target.focus();
      }
    },
  };
}
