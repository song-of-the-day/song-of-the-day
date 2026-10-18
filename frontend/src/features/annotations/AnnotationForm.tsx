import { useState, type SubmitEvent } from 'react';

import { hasErrorCode } from '@/api/errors';
import { useCreateAnnotation, useUpdateAnnotation } from '@/api/hooks/annotations';
import { describeApiError } from '@/api/messages';
import type { Annotation } from '@/api/types';
import { FormError } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextArea } from '@/components/ui/TextArea';
import { TextField } from '@/components/ui/TextField';
import { useFormErrors } from '@/features/auth/useFormErrors';
import { apiFieldErrors } from '@/features/auth/validation';
import { useFocusOnMount } from '@/hooks/useFocusOnMount';

import {
  BODY_MAX_LENGTH,
  NOTE_FIELDS,
  noteCreateInput,
  noteFormValues,
  noteUpdatePatch,
  validateNoteForm,
  type NoteFormValues,
} from './noteForm';
import { NoteColorPicker } from './NoteColorPicker';

export const ANNOTATION_LIMIT_MESSAGE =
  'This song already has 200 notes, the most it can hold. Delete one to add another.';

export interface AnnotationFormProps {
  entryId: number;
  /** The note to edit; omit to create one. */
  annotation?: Annotation;
  /** A new note's prefilled start (e.g. "Note at 1:23" or a drag). */
  initialStartMs?: number | null;
  /** A new note's prefilled end (a drag across the timeline). */
  initialEndMs?: number | null;
  /** Called with the saved note (or the unchanged one when nothing was edited). */
  onSaved: (annotation: Annotation) => void;
  onCancel: () => void;
}

/**
 * Creates or edits a sticky note: start and optional end as `m:ss`, the text (1–1000 characters)
 * and a color. Problems are shown next to their fields, including the API's, and focus moves to
 * the first one. Clearing the end of a range turns it into a point note.
 */
export function AnnotationForm({
  entryId,
  annotation,
  initialStartMs = null,
  initialEndMs = null,
  onSaved,
  onCancel,
}: AnnotationFormProps) {
  const [values, setValues] = useState<NoteFormValues>(() =>
    noteFormValues(annotation ?? { start_ms: initialStartMs, end_ms: initialEndMs }),
  );
  const { errors, formError, fieldId, showErrors, clearField } = useFormErrors(NOTE_FIELDS);
  const createAnnotation = useCreateAnnotation();
  const updateAnnotation = useUpdateAnnotation();
  const pending = createAnnotation.isPending || updateAnnotation.isPending;
  // Start where the user has something to type: the text when a time is already filled in.
  const focusText = annotation !== undefined || initialStartMs !== null;
  const startFocusRef = useFocusOnMount<HTMLInputElement>();
  const bodyFocusRef = useFocusOnMount<HTMLTextAreaElement>();

  function change<K extends keyof NoteFormValues>(key: K, value: NoteFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleError(error: unknown) {
    const fields = apiFieldErrors(error, NOTE_FIELDS);
    if (Object.keys(fields).length > 0) {
      showErrors(fields);
    } else if (hasErrorCode(error, 'annotation_limit_reached')) {
      showErrors({}, ANNOTATION_LIMIT_MESSAGE);
    } else {
      showErrors({}, describeApiError(error));
    }
  }

  function handleSaved(saved: Annotation) {
    onSaved(saved);
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    const { errors: problems, draft } = validateNoteForm(values);
    if (draft === null) {
      showErrors(problems);
      return;
    }
    showErrors({});
    if (annotation === undefined) {
      createAnnotation.mutate(
        { entryId, input: noteCreateInput(draft) },
        { onSuccess: handleSaved, onError: handleError },
      );
      return;
    }
    const patch = noteUpdatePatch(annotation, draft);
    if (Object.keys(patch).length === 0) {
      onSaved(annotation);
      return;
    }
    updateAnnotation.mutate(
      { entryId, id: annotation.id, patch },
      { onSuccess: handleSaved, onError: handleError },
    );
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      aria-label={annotation === undefined ? 'New note' : 'Edit note'}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <TextField
          ref={focusText ? undefined : startFocusRef}
          id={fieldId('start_ms')}
          label="Start"
          hint="m:ss"
          placeholder="1:23"
          autoComplete="off"
          value={values.start}
          error={errors.start_ms}
          onChange={(event) => {
            change('start', event.target.value);
            clearField('start_ms');
          }}
        />
        <TextField
          id={fieldId('end_ms')}
          label="End (optional)"
          hint="Leave empty for a moment"
          placeholder="1:45"
          autoComplete="off"
          value={values.end}
          error={errors.end_ms}
          onChange={(event) => {
            change('end', event.target.value);
            clearField('end_ms');
          }}
        />
      </div>
      <TextArea
        ref={focusText ? bodyFocusRef : undefined}
        id={fieldId('body')}
        label="Note"
        rows={3}
        maxLength={BODY_MAX_LENGTH}
        showCount
        value={values.body}
        error={errors.body}
        onChange={(event) => {
          change('body', event.target.value);
          clearField('body');
        }}
      />
      <NoteColorPicker
        id={fieldId('color')}
        value={values.color}
        error={errors.color}
        onChange={(color) => {
          change('color', color);
          clearField('color');
        }}
      />
      <FormError message={formError} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={pending}>
          {annotation === undefined ? 'Add note' : 'Save note'}
        </Button>
      </div>
    </form>
  );
}
