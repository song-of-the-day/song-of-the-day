import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface FieldMessageProps {
  id: string;
  children: ReactNode;
  className?: string;
}

/** Help text under a control, referenced by its `aria-describedby`. */
export function FieldHint({ id, children, className }: FieldMessageProps) {
  return (
    <p id={id} className={cn('text-sm text-muted', className)}>
      {children}
    </p>
  );
}

/**
 * A control's validation message, referenced by its `aria-describedby`. The icon keeps the error
 * recognizable without relying on color.
 */
export function FieldError({ id, children, className }: FieldMessageProps) {
  return (
    <p id={id} className={cn('flex items-start gap-1.5 text-sm font-medium text-fg', className)}>
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
      <span>{children}</span>
    </p>
  );
}
