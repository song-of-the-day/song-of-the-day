import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type AlertTone = 'info' | 'success' | 'error';

const ICONS = {
  info: Info,
  success: CircleCheck,
  error: CircleAlert,
} as const;

export interface AlertProps {
  tone?: AlertTone;
  /** A bold first line. */
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/**
 * An inline message on a surface panel. Errors use `role="alert"` (announced immediately);
 * info and success use `role="status"` (announced politely). The icon distinguishes tones
 * without relying on color.
 */
export function Alert({ tone = 'info', title, children, className }: AlertProps) {
  const Icon = ICONS[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-md border border-l-4 border-muted border-l-accent bg-surface p-3 text-sm text-fg',
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
      <div className="min-w-0 flex-1 break-words">
        {title !== undefined && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export interface FormErrorProps {
  /** The form-level error, or nothing to render nothing. */
  message: ReactNode;
  className?: string;
}

/**
 * A form-level error (e.g. wrong credentials, rate limits) shown above the form's actions.
 * Renders nothing without a message.
 */
export function FormError({ message, className }: FormErrorProps) {
  if (message === null || message === undefined || message === false || message === '') {
    return null;
  }
  return (
    <Alert tone="error" className={className}>
      {message}
    </Alert>
  );
}
