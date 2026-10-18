import { ChevronDown } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { CONTROL_CLASS_NAME, hasContent, joinIds, useFieldIds } from './field';
import { FieldError, FieldHint } from './FieldMessage';

export interface SelectProps extends ComponentPropsWithRef<'select'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  containerClassName?: string;
  /** The `<option>` elements. */
  children: ReactNode;
}

/**
 * A labelled native `<select>` (native for the best keyboard, screen-reader and mobile support),
 * restyled with the control outline and a chevron.
 */
export function Select({
  label,
  hint,
  error,
  id,
  className,
  containerClassName,
  children,
  'aria-describedby': describedBy,
  ...props
}: SelectProps) {
  const { controlId, hintId, errorId } = useFieldIds(id);
  const hasHint = hasContent(hint);
  const hasError = hasContent(error);

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      <label htmlFor={controlId} className="text-sm font-medium text-fg">
        {label}
      </label>
      <div className="relative">
        <select
          id={controlId}
          className={cn(CONTROL_CLASS_NAME, 'cursor-pointer appearance-none pr-10', className)}
          aria-invalid={hasError || undefined}
          aria-describedby={joinIds(describedBy, hasHint && hintId, hasError && errorId)}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted"
        />
      </div>
      {hasHint && <FieldHint id={hintId}>{hint}</FieldHint>}
      {hasError && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}
