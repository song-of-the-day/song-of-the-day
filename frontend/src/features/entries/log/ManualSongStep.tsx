import type { RefCallback, SubmitEvent } from 'react';

import { Alert } from '@/components/ui/Alert';
import { TextField } from '@/components/ui/TextField';
import type { FieldErrorMap } from '@/features/auth/validation';

import { TEXT_MAX_LENGTH, URL_MAX_LENGTH, type ManualField, type ManualValues } from './validation';

export interface ManualSongStepProps {
  /** The form's id; the dialog footer's Continue button submits it. */
  formId: string;
  values: ManualValues;
  errors: FieldErrorMap<ManualField>;
  /** The DOM id of a field's input (for focusing the first invalid one). */
  fieldId: (field: ManualField) => string;
  /** Shown above the form, e.g. when search is unavailable. */
  notice: string | null;
  onChange: (field: ManualField, value: string) => void;
  onSubmit: () => void;
  /** Receives the title input, which takes focus when the step opens. */
  titleRef: RefCallback<HTMLInputElement>;
}

/**
 * The log dialog's manual song form: title and artist, plus an optional album, length (m:ss)
 * and link.
 */
export function ManualSongStep({
  formId,
  values,
  errors,
  fieldId,
  notice,
  onChange,
  onSubmit,
  titleRef,
}: ManualSongStepProps) {
  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  function field(name: ManualField) {
    return {
      id: fieldId(name),
      value: values[name],
      error: errors[name],
      onChange: (event: { target: { value: string } }) => {
        onChange(name, event.target.value);
      },
    };
  }

  return (
    <form id={formId} noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      {notice !== null && <Alert tone="info">{notice}</Alert>}
      <TextField
        {...field('title')}
        ref={titleRef}
        label="Title"
        required
        maxLength={TEXT_MAX_LENGTH}
        autoComplete="off"
      />
      <TextField
        {...field('artist')}
        label="Artist"
        required
        maxLength={TEXT_MAX_LENGTH}
        autoComplete="off"
      />
      <TextField
        {...field('album')}
        label="Album (optional)"
        maxLength={TEXT_MAX_LENGTH}
        autoComplete="off"
      />
      <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
        <TextField
          {...field('duration_ms')}
          label="Length (optional)"
          placeholder="3:45"
          hint="m:ss"
          autoComplete="off"
        />
        <TextField
          {...field('external_url')}
          label="Link (optional)"
          type="url"
          inputMode="url"
          placeholder="https://"
          hint="Bandcamp, Spotify, SoundCloud…"
          maxLength={URL_MAX_LENGTH}
          autoComplete="off"
        />
      </div>
    </form>
  );
}
