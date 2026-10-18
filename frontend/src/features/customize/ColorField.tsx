import { useState } from 'react';

import { CONTROL_CLASS_NAME, joinIds, useFieldIds } from '@/components/ui/field';
import { FieldError } from '@/components/ui/FieldMessage';
import { cn } from '@/lib/cn';

import { parseHexInput } from './draft';
import { HEX_FORMAT_MESSAGE } from './copy';

export interface ColorFieldProps {
  /** The visible label, e.g. "Background"; names the hex field. */
  label: string;
  /** The current color (`#RRGGBB`). */
  color: string;
  /** The hex field's text, which may not be a color yet. */
  text: string;
  /** Id for the hex field, so a form can move focus to it. */
  id: string;
  /** A message from the server or from a save attempt. */
  error?: string;
  onPick: (hex: string) => void;
  onTextChange: (text: string) => void;
  onTextBlur: () => void;
}

/**
 * One theme color: a native color picker plus a `#RRGGBB` text field. The text field reports a
 * format problem once the user leaves it (or when the form says so via `error`).
 */
export function ColorField({
  label,
  color,
  text,
  id,
  error,
  onPick,
  onTextChange,
  onTextBlur,
}: ColorFieldProps) {
  const { controlId, errorId } = useFieldIds(id);
  const [blurred, setBlurred] = useState(false);
  const formatError = blurred && parseHexInput(text) === null ? HEX_FORMAT_MESSAGE : undefined;
  const message = error ?? formatError;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5">
        <label htmlFor={controlId} className="min-w-0 flex-1 text-sm font-medium text-fg">
          {label}
        </label>
        <input
          type="color"
          aria-label={`${label} color picker`}
          value={color.toLowerCase()}
          onChange={(event) => {
            onPick(event.target.value);
          }}
          className={cn(
            'h-11 w-12 shrink-0 cursor-pointer rounded-md border border-muted bg-surface p-1',
            '[&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-line [&::-webkit-color-swatch-wrapper]:p-0',
            '[&::-moz-color-swatch]:rounded-sm [&::-moz-color-swatch]:border-line',
          )}
        />
        <div className="w-28 shrink-0">
          <input
            id={controlId}
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={9}
            value={text}
            aria-invalid={message !== undefined || undefined}
            aria-describedby={joinIds(message !== undefined && errorId)}
            onChange={(event) => {
              onTextChange(event.target.value);
            }}
            onBlur={() => {
              setBlurred(true);
              onTextBlur();
            }}
            className={cn(CONTROL_CLASS_NAME, 'font-mono')}
          />
        </div>
      </div>
      {message !== undefined && <FieldError id={errorId}>{message}</FieldError>}
    </div>
  );
}
