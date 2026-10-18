import type { ReactNode, RefCallback, SubmitEvent } from 'react';

import type { YouTubeMatch } from '@/api/types';
import { FormError } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextArea } from '@/components/ui/TextArea';
import { TextField } from '@/components/ui/TextField';
import type { FieldErrorMap } from '@/features/auth/validation';
import { YouTubeMatchNote } from '@/features/player/YouTubeMatchNote';

import { SongSummary } from './SongSummary';
import type { SongDraft } from './songDraft';
import {
  MIN_ENTRY_DATE,
  NOTE_MAX_LENGTH,
  URL_MAX_LENGTH,
  type DetailsField,
  type DetailsValues,
} from './validation';

export interface DetailsStepProps {
  /** The form's id; the dialog footer's Save button submits it. */
  formId: string;
  song: SongDraft;
  /** Start the song's preview right away (it was just picked and the viewer allows auto-play). */
  autoPlayPreview: boolean;
  values: DetailsValues;
  errors: FieldErrorMap<DetailsField>;
  /** The DOM id of a field's control (for focusing the first invalid one). */
  fieldId: (field: DetailsField) => string;
  /** Today's date: the latest day that can be picked. */
  today: string;
  /** The `409 entry_exists` explanation, if the day is taken. */
  conflict: ReactNode;
  /** The auto-matched video that prefilled the YouTube field. */
  match: YouTubeMatch | null;
  /** Rejects the matched video: clears the field and hides the suggestion. */
  onDismissMatch: () => void;
  formError: string | null;
  onChange: (field: DetailsField, value: string) => void;
  onChangeSong: () => void;
  onSubmit: () => void;
  /** Receives the song summary, which takes focus when the step opens. */
  summaryRef: RefCallback<HTMLElement>;
}

/**
 * The log dialog's details step: the chosen song, the day (today or earlier), a note and an
 * optional YouTube link.
 */
export function DetailsStep({
  formId,
  song,
  autoPlayPreview,
  values,
  errors,
  fieldId,
  today,
  conflict,
  match,
  onDismissMatch,
  formError,
  onChange,
  onChangeSong,
  onSubmit,
  summaryRef,
}: DetailsStepProps) {
  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form id={formId} noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <SongSummary
        song={song}
        autoPlayPreview={autoPlayPreview}
        onChangeSong={onChangeSong}
        summaryRef={summaryRef}
      />
      <TextField
        id={fieldId('entry_date')}
        label="Date"
        type="date"
        required
        min={MIN_ENTRY_DATE}
        max={today}
        value={values.entry_date}
        error={errors.entry_date}
        onChange={(event) => {
          onChange('entry_date', event.target.value);
        }}
      />
      <TextArea
        id={fieldId('note')}
        label="Note (optional)"
        placeholder="What made it the song of the day?"
        maxLength={NOTE_MAX_LENGTH}
        showCount
        value={values.note}
        error={errors.note}
        onChange={(event) => {
          onChange('note', event.target.value);
        }}
      />
      <TextField
        id={fieldId('youtube_video_id')}
        label="YouTube link (optional)"
        type="url"
        inputMode="url"
        placeholder="https://youtu.be/…"
        hint="Add a YouTube link to take notes while it plays"
        maxLength={URL_MAX_LENGTH}
        autoComplete="off"
        value={values.youtube_video_id}
        error={errors.youtube_video_id}
        onChange={(event) => {
          onChange('youtube_video_id', event.target.value);
        }}
      />
      {match !== null && (
        <YouTubeMatchNote match={match}>
          <Button size="sm" variant="ghost" onClick={onDismissMatch}>
            Not this one
          </Button>
        </YouTubeMatchNote>
      )}
      {conflict}
      <FormError message={formError} />
    </form>
  );
}
