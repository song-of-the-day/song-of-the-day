import { useId, type ReactNode } from 'react';

import { FieldHint } from '@/components/ui/FieldMessage';
import { cn } from '@/lib/cn';

export interface ChoiceGroupProps<T extends string> {
  /** The group's accessible name. */
  legend: string;
  /** Show the legend as a label above the choices (default: screen readers only). */
  showLegend?: boolean;
  options: readonly T[];
  value: T | null;
  onChange: (value: T) => void;
  /** Draws one choice's content (inside its label). */
  renderOption: (value: T, checked: boolean) => ReactNode;
  /** The choice's accessible name when its content isn't text. */
  optionLabel?: (value: T) => string;
  disabled?: boolean;
  hint?: ReactNode;
  className?: string;
  optionClassName?: string;
}

/**
 * A group of visual radio cards: native radios (Tab enters at the selected one, arrow keys move and
 * select) inside labels that show the checked state with an accent ring.
 */
export function ChoiceGroup<T extends string>({
  legend,
  showLegend = false,
  options,
  value,
  onChange,
  renderOption,
  optionLabel,
  disabled = false,
  hint,
  className,
  optionClassName,
}: ChoiceGroupProps<T>) {
  const name = useId();
  const hintId = `${name}-hint`;
  const hasHint = hint !== undefined;
  return (
    <fieldset
      role="radiogroup"
      disabled={disabled}
      aria-describedby={hasHint ? hintId : undefined}
      className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
    >
      <legend className={showLegend ? 'mb-2 text-sm font-medium text-fg' : 'sr-only'}>
        {legend}
      </legend>
      <div className={className}>
        {options.map((option) => {
          const checked = option === value;
          return (
            <label
              key={option}
              className={cn(
                'relative flex cursor-pointer rounded-md border border-muted bg-surface text-fg select-none motion-safe:transition-shadow',
                'hover:border-fg has-checked:border-accent has-checked:ring-2 has-checked:ring-accent',
                'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent',
                'has-disabled:cursor-not-allowed has-disabled:opacity-50 has-disabled:hover:border-muted',
                optionClassName,
              )}
            >
              <input
                type="radio"
                name={name}
                value={option}
                checked={checked}
                aria-label={optionLabel?.(option)}
                onChange={() => {
                  onChange(option);
                }}
                className="sr-only"
              />
              {renderOption(option, checked)}
            </label>
          );
        })}
      </div>
      {hasHint && <FieldHint id={hintId}>{hint}</FieldHint>}
    </fieldset>
  );
}
