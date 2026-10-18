/**
 * The toast API (see `ToastProvider` in `Toast.tsx`).
 */
import { createContext, useContext } from 'react';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastOptions {
  tone?: ToastTone;
  /** How long the toast stays, in milliseconds (paused while hovered or focused). */
  durationMs?: number;
}

export interface ToastApi {
  /**
   * Shows a short message.
   *
   * @returns The toast's id, for {@link ToastApi.dismiss}.
   */
  show: (message: string, options?: ToastOptions) => number;
  /** Removes a toast early. */
  dismiss: (id: number) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

/**
 * Accesses the toast API.
 *
 * @returns `show` and `dismiss`.
 * @throws Error when rendered outside a `ToastProvider`.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) {
    throw new Error('useToast must be used inside a ToastProvider');
  }
  return api;
}
