/**
 * Values, validation and payloads of the annotation form. The checks mirror the API's rules
 * for instant feedback; the API stays the authority.
 */
import type { Annotation, AnnotationCreateInput, AnnotationPatch } from '@/api/types';
import type { FieldErrorMap } from '@/features/auth/validation';
import type { NoteColorKey } from '@/lib/theme';
import { formatMs, parseTimestamp } from '@/lib/time';

/** The form's fields, named like the request body keys, in display order. */
export const NOTE_FIELDS = ['start_ms', 'end_ms', 'body', 'color'] as const;
export type NoteField = (typeof NOTE_FIELDS)[number];

export const BODY_MAX_LENGTH = 1000;
/** The latest position the API accepts (24 hours). */
export const MAX_POSITION_MS = 86_400_000;
export const DEFAULT_NOTE_COLOR: NoteColorKey = 'yellow';

export const START_REQUIRED_MESSAGE = 'Enter a start time, like 1:23.';
export const TIME_FORMAT_MESSAGE = 'Use minutes and seconds, like 1:23.';
export const TIME_TOO_LATE_MESSAGE = 'Use a time within 24 hours.';
export const END_BEFORE_START_MESSAGE = 'The end must be after the start.';
export const BODY_REQUIRED_MESSAGE = 'Write a note.';
export const BODY_TOO_LONG_MESSAGE = `Use at most ${String(BODY_MAX_LENGTH)} characters.`;

/** What the user typed. */
export interface NoteFormValues {
  start: string;
  end: string;
  body: string;
  color: NoteColorKey;
}

/** A valid note, ready to send. */
export interface NoteDraft {
  start_ms: number;
  end_ms: number | null;
  body: string;
  color: NoteColorKey;
}

/** Initial values: a note to edit, or a new note's prefilled times. */
export interface NoteFormSource {
  start_ms?: number | null;
  end_ms?: number | null;
  body?: string;
  color?: NoteColorKey;
}

/**
 * Builds the form's starting values.
 *
 * @param source - An existing note, or prefilled times for a new one.
 * @returns Times as `m:ss` (empty when absent), the body and the color (yellow by default).
 */
export function noteFormValues(source: NoteFormSource = {}): NoteFormValues {
  const { start_ms: start = null, end_ms: end = null } = source;
  return {
    start: start === null ? '' : formatMs(start),
    end: end === null ? '' : formatMs(end),
    body: source.body ?? '',
    color: source.color ?? DEFAULT_NOTE_COLOR,
  };
}

function parsePosition(text: string): number | string {
  const ms = parseTimestamp(text);
  if (ms === null) {
    return TIME_FORMAT_MESSAGE;
  }
  return ms > MAX_POSITION_MS ? TIME_TOO_LATE_MESSAGE : ms;
}

/**
 * Validates the form.
 *
 * @param values - What the user typed.
 * @returns Messages per invalid field, and the note when everything is valid (`null` otherwise).
 */
export function validateNoteForm(values: NoteFormValues): {
  errors: FieldErrorMap<NoteField>;
  draft: NoteDraft | null;
} {
  const errors: FieldErrorMap<NoteField> = {};
  const start = values.start.trim() === '' ? START_REQUIRED_MESSAGE : parsePosition(values.start);
  const end = values.end.trim() === '' ? null : parsePosition(values.end);
  if (typeof start === 'string') {
    errors.start_ms = start;
  }
  if (typeof end === 'string') {
    errors.end_ms = end;
  } else if (typeof start === 'number' && end !== null && end <= start) {
    errors.end_ms = END_BEFORE_START_MESSAGE;
  }
  const body = values.body.trim();
  if (body === '') {
    errors.body = BODY_REQUIRED_MESSAGE;
  } else if (Array.from(body).length > BODY_MAX_LENGTH) {
    // Counted by code point, like the API.
    errors.body = BODY_TOO_LONG_MESSAGE;
  }
  if (typeof start === 'string' || typeof end === 'string' || Object.keys(errors).length > 0) {
    return { errors, draft: null };
  }
  return { errors, draft: { start_ms: start, end_ms: end, body, color: values.color } };
}

/**
 * Builds the create payload.
 *
 * @param draft - A valid note.
 * @returns The body for `POST …/annotations` (`end_ms` only for a range).
 */
export function noteCreateInput(draft: NoteDraft): AnnotationCreateInput {
  const { end_ms: end, ...rest } = draft;
  return end === null ? rest : { ...rest, end_ms: end };
}

function timeChanged(saved: number | null, edited: number | null): boolean {
  if (saved === null || edited === null) {
    return saved !== edited;
  }
  return formatMs(saved) !== formatMs(edited);
}

/**
 * Builds the update payload from the fields that changed. Times are compared as `m:ss` (what the
 * form shows), so a saved sub-second position is kept unless the user retyped it.
 *
 * @param annotation - The note as saved.
 * @param draft - The edited, valid note.
 * @returns The changed fields; a cleared end becomes `end_ms: null` (a point note).
 */
export function noteUpdatePatch(annotation: Annotation, draft: NoteDraft): AnnotationPatch {
  const patch: AnnotationPatch = {};
  if (timeChanged(annotation.start_ms, draft.start_ms)) {
    patch.start_ms = draft.start_ms;
  }
  if (timeChanged(annotation.end_ms, draft.end_ms)) {
    patch.end_ms = draft.end_ms;
  }
  if (draft.body !== annotation.body) {
    patch.body = draft.body;
  }
  if (draft.color !== annotation.color) {
    patch.color = draft.color;
  }
  return patch;
}
