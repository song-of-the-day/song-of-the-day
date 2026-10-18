import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** An icon before the label (decorative). */
  icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  /** The group's accessible name, e.g. "View". */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}

const SEGMENT_SIZES = {
  sm: 'min-h-8 px-3 text-sm',
  md: 'min-h-10 px-4 text-sm',
} as const;

/**
 * A pill-shaped single choice, built on native radio buttons inside a `radiogroup` labelled by its
 * legend: Tab enters it at the selected option and the arrow keys move (and select) within it.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size = 'md',
  className,
}: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <fieldset
      role="radiogroup"
      className={cn(
        'm-0 inline-flex min-w-0 rounded-full border border-muted bg-surface p-0.5',
        className,
      )}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label key={option.value} className="relative flex">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => {
              onChange(option.value);
            }}
            className="peer sr-only"
          />
          <span
            className={cn(
              'flex cursor-pointer items-center gap-1.5 rounded-full font-semibold whitespace-nowrap text-fg select-none motion-safe:transition-colors',
              'peer-checked:bg-accent peer-checked:text-accent-contrast peer-checked:shadow-[inset_0_1px_0_var(--y2k-gloss)]',
              'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
              'hover:bg-fg/5 peer-checked:hover:bg-accent',
              SEGMENT_SIZES[size],
            )}
          >
            {option.icon}
            {option.label}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
