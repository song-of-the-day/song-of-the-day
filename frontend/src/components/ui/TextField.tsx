import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { CONTROL_CLASS_NAME, hasContent, joinIds, useFieldIds } from './field';
import { FieldError, FieldHint } from './FieldMessage';

export interface TextFieldProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
  label: ReactNode;
  /** Help text below the input. */
  hint?: ReactNode;
  /** A validation message; marks the input invalid. */
  error?: ReactNode;
  /** An element inside the input's right edge, e.g. a show-password toggle. */
  trailing?: ReactNode;
  /** Classes for the wrapper (label, input and messages). */
  containerClassName?: string;
}

/**
 * A labelled single-line input. The hint and error are wired to the input with
 * `aria-describedby`, and an error sets `aria-invalid`. `ref` reaches the `<input>`.
 */
export function TextField({
  label,
  hint,
  error,
  trailing,
  id,
  type = 'text',
  className,
  containerClassName,
  'aria-describedby': describedBy,
  ...props
}: TextFieldProps) {
  const { controlId, hintId, errorId } = useFieldIds(id);
  const hasHint = hasContent(hint);
  const hasError = hasContent(error);

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      <label htmlFor={controlId} className="text-sm font-medium text-fg">
        {label}
      </label>
      <div className="relative">
        <input
          id={controlId}
          type={type}
          className={cn(CONTROL_CLASS_NAME, trailing !== undefined && 'pr-12', className)}
          aria-invalid={hasError || undefined}
          aria-describedby={joinIds(describedBy, hasHint && hintId, hasError && errorId)}
          {...props}
        />
        {trailing !== undefined && (
          <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>
        )}
      </div>
      {hasHint && <FieldHint id={hintId}>{hint}</FieldHint>}
      {hasError && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}
