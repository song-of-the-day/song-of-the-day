import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface SwitchProps {
  label: ReactNode;
  /** A short explanation under the label. */
  hint?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * An on/off switch (`role="switch"` with `aria-checked`) for settings that apply immediately.
 * The track is outlined like other form controls and fills with the accent when on.
 */
export function Switch({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled = false,
  className,
}: SwitchProps) {
  const labelId = useId();
  const hintId = useId();
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <span id={labelId} className="text-sm text-fg">
          {label}
        </span>
        {hint !== undefined && (
          <span id={hintId} className="text-xs text-muted">
            {hint}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={hint === undefined ? undefined : hintId}
        disabled={disabled}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-muted transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none',
          checked ? 'bg-accent' : 'bg-surface',
        )}
        onClick={() => {
          onCheckedChange(!checked);
        }}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-block size-4 rounded-full border border-muted bg-surface shadow-sm transition-transform motion-reduce:transition-none',
            checked ? 'translate-x-6' : 'translate-x-1',
          )}
        />
      </button>
    </div>
  );
}
