import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from 'react';

import { IconButton } from './IconButton';
import { ToastContext, type ToastApi, type ToastOptions, type ToastTone } from './useToast';

export const DEFAULT_TOAST_DURATION_MS = 5000;
export const MAX_TOASTS = 3;

const ICONS = {
  info: Info,
  success: CircleCheck,
  error: CircleAlert,
} as const;

interface ToastRecord {
  id: number;
  message: string;
  tone: ToastTone;
  durationMs: number;
}

interface ToastItemProps {
  toast: ToastRecord;
  onDismiss: (id: number) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const { id, durationMs } = toast;

  useEffect(() => {
    if (paused) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      onDismiss(id);
    }, durationMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [paused, id, durationMs, onDismiss]);

  function handleBlur(event: FocusEvent<HTMLLIElement>) {
    if (!(
      event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)
    )) {
      setFocused(false);
    }
  }

  const Icon = ICONS[toast.tone];
  return (
    <li
      className="y2k-window pointer-events-auto flex w-full items-start gap-2.5 py-2 pr-1.5 pl-3 text-sm text-fg motion-safe:animate-pop-in"
      data-tone={toast.tone}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={handleBlur}
    >
      <Icon aria-hidden="true" className="mt-2 size-4 shrink-0 text-accent" />
      <p className="min-w-0 flex-1 py-1.5 break-words">{toast.message}</p>
      <IconButton
        label="Dismiss notification"
        size="sm"
        onClick={() => {
          onDismiss(id);
        }}
      >
        <X className="size-4" />
      </IconButton>
    </li>
  );
}

export interface ToastProviderProps {
  children: ReactNode;
}

/**
 * Provides {@link useToast} and renders the toasts in a polite live region (top on phones, bottom
 * right on wider screens). Toasts dismiss themselves after a while, pause while hovered or
 * focused, and at most {@link MAX_TOASTS} show at once.
 */
export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const lastId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (
      message: string,
      { tone = 'info', durationMs = DEFAULT_TOAST_DURATION_MS }: ToastOptions = {},
    ) => {
      lastId.current += 1;
      const id = lastId.current;
      setToasts((current) => [...current, { id, message, tone, durationMs }].slice(-MAX_TOASTS));
      return id;
    },
    [],
  );

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext value={api}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions text"
        className="pointer-events-none fixed inset-x-0 top-0 z-60 flex justify-center p-4 sm:top-auto sm:bottom-0 sm:justify-end"
      >
        <ol aria-label="Notifications" className="flex w-full max-w-sm flex-col gap-2">
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </ol>
      </div>
    </ToastContext>
  );
}
