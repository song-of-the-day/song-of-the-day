import { Check } from 'lucide-react';
import { useId } from 'react';

import { FieldError } from '@/components/ui/FieldMessage';
import { noteColorOptions, type NoteColorKey } from '@/lib/theme';

import { noteColorStyle } from './noteColors';

export interface NoteColorPickerProps {
  value: NoteColorKey;
  onChange: (color: NoteColorKey) => void;
  /** The fieldset's id (so a validation error can move focus to it). */
  id?: string;
  error?: string;
}

/**
 * The five sticky-note colors as radio swatches. Each swatch is named by its color, and the
 * chosen one shows a check mark, so the choice never relies on color alone.
 */
export function NoteColorPicker({ value, onChange, id, error }: NoteColorPickerProps) {
  const name = useId();
  const errorId = `${name}-error`;
  return (
    <fieldset
      id={id}
      tabIndex={-1}
      aria-describedby={error === undefined ? undefined : errorId}
      className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0 outline-none"
    >
      <legend className="mb-1.5 p-0 text-sm font-medium text-fg">Color</legend>
      <div className="flex flex-wrap gap-2.5">
        {noteColorOptions.map((option) => {
          const checked = option.key === value;
          return (
            <label key={option.key} title={option.label} className="relative flex cursor-pointer">
              <input
                type="radio"
                name={name}
                value={option.key}
                checked={checked}
                onChange={() => {
                  onChange(option.key);
                }}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                style={noteColorStyle(option.key)}
                className="flex size-9 items-center justify-center rounded-full border border-fg bg-(--y2k-note-color) text-(--sotd-note-ink) peer-checked:ring-2 peer-checked:ring-accent peer-checked:ring-offset-2 peer-checked:ring-offset-surface peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent"
              >
                {checked && <Check className="size-4" strokeWidth={3} />}
              </span>
              <span className="sr-only">{option.label}</span>
            </label>
          );
        })}
      </div>
      {error !== undefined && <FieldError id={errorId}>{error}</FieldError>}
    </fieldset>
  );
}
