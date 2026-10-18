import { useState, type ChangeEvent, type ComponentPropsWithRef, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { CONTROL_CLASS_NAME, hasContent, joinIds, useFieldIds } from './field';
import { FieldError, FieldHint } from './FieldMessage';

export interface TextAreaProps extends ComponentPropsWithRef<'textarea'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Show a "used / maxLength" counter (requires `maxLength`). */
  showCount?: boolean;
  containerClassName?: string;
}

function lengthOf(value: TextAreaProps['value']): number {
  if (value === undefined) {
    return 0;
  }
  return (Array.isArray(value) ? value.join(',') : String(value)).length;
}

/**
 * A labelled multi-line input with an optional character counter. The counter is part of the
 * description (read when the field is focused) rather than a live region, so it doesn't
 * interrupt typing. Works controlled (`value`) or uncontrolled (`defaultValue`).
 */
export function TextArea({
  label,
  hint,
  error,
  showCount = false,
  maxLength,
  id,
  rows = 4,
  className,
  containerClassName,
  value,
  defaultValue,
  onChange,
  'aria-describedby': describedBy,
  ...props
}: TextAreaProps) {
  const { controlId, hintId, errorId } = useFieldIds(id);
  const counterId = `${controlId}-count`;
  const [uncontrolledLength, setUncontrolledLength] = useState(() => lengthOf(defaultValue));
  const length = value === undefined ? uncontrolledLength : lengthOf(value);
  const hasHint = hasContent(hint);
  const hasError = hasContent(error);
  const hasCounter = showCount && maxLength !== undefined;

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setUncontrolledLength(event.target.value.length);
    onChange?.(event);
  }

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      <label htmlFor={controlId} className="text-sm font-medium text-fg">
        {label}
      </label>
      <textarea
        id={controlId}
        rows={rows}
        maxLength={maxLength}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        className={cn(CONTROL_CLASS_NAME, 'resize-y', className)}
        aria-invalid={hasError || undefined}
        aria-describedby={joinIds(
          describedBy,
          hasHint && hintId,
          hasError && errorId,
          hasCounter && counterId,
        )}
        {...props}
      />
      {(hasHint || hasCounter) && (
        <div className="flex items-start justify-between gap-3">
          {hasHint ? <FieldHint id={hintId}>{hint}</FieldHint> : <span />}
          {hasCounter && (
            <p id={counterId} className="shrink-0 text-sm text-muted tabular-nums">
              <span aria-hidden="true">
                {length} / {maxLength}
              </span>
              <span className="sr-only">{`${String(length)} of ${String(maxLength)} characters used`}</span>
            </p>
          )}
        </div>
      )}
      {hasError && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}
