import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { hasContent, joinIds, useFieldIds } from './field';
import { FieldError, FieldHint } from './FieldMessage';

export interface CheckboxProps extends Omit<ComponentPropsWithRef<'input'>, 'type' | 'size'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  containerClassName?: string;
}

/**
 * A labelled native checkbox, tinted with the theme accent.
 */
export function Checkbox({
  label,
  hint,
  error,
  id,
  className,
  containerClassName,
  'aria-describedby': describedBy,
  ...props
}: CheckboxProps) {
  const { controlId, hintId, errorId } = useFieldIds(id);
  const hasHint = hasContent(hint);
  const hasError = hasContent(error);

  return (
    <div className={cn('flex flex-col gap-1', containerClassName)}>
      <div className="flex items-start gap-2.5">
        <input
          id={controlId}
          type="checkbox"
          className={cn('mt-0.5 size-5 shrink-0 cursor-pointer accent-accent', className)}
          aria-invalid={hasError || undefined}
          aria-describedby={joinIds(describedBy, hasHint && hintId, hasError && errorId)}
          {...props}
        />
        <label htmlFor={controlId} className="cursor-pointer text-sm text-fg select-none">
          {label}
        </label>
      </div>
      {hasHint && (
        <FieldHint id={hintId} className="pl-7.5">
          {hint}
        </FieldHint>
      )}
      {hasError && (
        <FieldError id={errorId} className="pl-7.5">
          {error}
        </FieldError>
      )}
    </div>
  );
}
