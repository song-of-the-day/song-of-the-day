/**
 * The EntryDetailDialog's edit mode: the draft song, day, note, length and
 * YouTube link of one in-place edit, with validation, saving and the unsaved-changes check.
 */
import { useId, useState } from 'react';

import { existingEntryId } from '@/api/errors';
import { useUpdateEntry } from '@/api/hooks/entries';
import { describeApiError } from '@/api/messages';
import type { EntryDetail } from '@/api/types';
import { useToast } from '@/components/ui/useToast';
import { apiFieldErrors, firstInvalidField, type FieldErrorMap } from '@/features/auth/validation';
import type { SongResult } from '@/lib/itunes';
import { formatMs } from '@/lib/time';
import { watchUrl } from '@/lib/youtube';

import { SEARCH_UNAVAILABLE_MESSAGE } from '../log/messages';
import { buildEditPatch } from '../log/payloads';
import { sameSong, songFromEntry, type SongDraft } from '../log/songDraft';
import {
  checkLength,
  DETAILS_FIELDS,
  detailsFromEntry,
  EMPTY_MANUAL_VALUES,
  MANUAL_FIELDS,
  manualValuesFromSong,
  validateDetails,
  validateManualSong,
  type DetailsField,
  type DetailsValues,
  type ManualField,
  type ManualValues,
} from '../log/validation';

/** The edit form's steps: the details, the song search, or the manual song form. */
export type EntryEditStep = 'details' | 'search' | 'manual';

/** A `409 entry_exists`: the day the draft would move to already has an entry. */
export interface EntryEditConflict {
  /** The entry that holds the day (`existing_entry_id`). */
  entryId: number;
  /** The day the draft asked for. */
  date: string;
}

/** Everything one edit session remembers; replaced when a new session starts. */
interface EditState {
  step: EntryEditStep;
  song: SongDraft;
  /** The editor of the m:ss length field (manual songs). */
  length: string;
  term: string;
  /** The song was just picked from search, so its summary may start the preview. */
  picked: boolean;
  manual: ManualValues;
  manualNotice: string | null;
  manualErrors: FieldErrorMap<ManualField>;
  details: DetailsValues;
  detailsErrors: FieldErrorMap<DetailsField>;
  lengthError: string | null;
  formError: string | null;
  conflict: EntryEditConflict | null;
}

const EMPTY_SONG: SongDraft = {
  source: 'manual',
  source_id: null,
  title: '',
  artist: '',
  album: null,
  artwork_url: null,
  preview_url: null,
  external_url: null,
  duration_ms: null,
};

const EMPTY_EDIT_STATE: EditState = {
  step: 'details',
  song: EMPTY_SONG,
  length: '',
  term: '',
  picked: false,
  manual: EMPTY_MANUAL_VALUES,
  manualNotice: null,
  manualErrors: {},
  details: { entry_date: '', note: '', youtube_video_id: '' },
  detailsErrors: {},
  lengthError: null,
  formError: null,
  conflict: null,
};

/** The length field's text for a saved length. */
function lengthText(durationMs: number | null): string {
  return durationMs === null ? '' : formatMs(durationMs);
}

/** The YouTube field's text for an entry. */
function youtubeText(entry: EntryDetail): string {
  return entry.youtube_video_id === null ? '' : watchUrl(entry.youtube_video_id);
}

function initialEditState(entry: EntryDetail): EditState {
  return {
    ...EMPTY_EDIT_STATE,
    song: songFromEntry(entry),
    length: lengthText(entry.duration_ms),
    details: detailsFromEntry(entry),
  };
}

/** Whether the draft would change something the Save button sends. */
function hasChanges(entry: EntryDetail, song: SongDraft, details: DetailsValues): boolean {
  return (
    !sameSong(song, songFromEntry(entry)) ||
    details.entry_date !== entry.entry_date ||
    details.note.trim() !== (entry.note ?? '') ||
    details.youtube_video_id.trim() !== youtubeText(entry)
  );
}

function hasInput(values: ManualValues): boolean {
  return Object.values(values).some((value) => value !== '');
}

/** Removes one field's message. */
function withoutField<Field extends string>(
  errors: FieldErrorMap<Field>,
  field: Field,
): FieldErrorMap<Field> {
  if (errors[field] === undefined) {
    return errors;
  }
  const { [field]: _cleared, ...rest } = errors;
  return rest as FieldErrorMap<Field>;
}

export interface UseEntryEditOptions {
  /** Whether the dialog is in edit mode. */
  active: boolean;
  /** The entry being edited; only needed while `active`. */
  entry: EntryDetail | null;
  /** Today: the latest day the date field allows. */
  today: string;
  /** The viewer's auto-play preference: a song picked right now may start its preview. */
  autoPlayPreview: boolean;
  /** Leaves edit mode (Cancel, or after a successful save). */
  onExit: () => void;
}

/**
 * The edit-mode controller: it owns every draft field and error, saves the changed fields with a
 * PATCH, and reports whether leaving would drop unsaved changes.
 */
export interface EntryEditController {
  step: EntryEditStep;
  /** The draft song (the saved song until another one is chosen). */
  song: SongDraft;
  /** The length field's text (`m:ss`, manual songs only). */
  length: string;
  /** The draft day, note and YouTube link. */
  values: DetailsValues;
  term: string;
  manual: ManualValues;
  manualNotice: string | null;
  manualErrors: FieldErrorMap<ManualField>;
  detailsErrors: FieldErrorMap<DetailsField>;
  lengthError: string | null;
  formError: string | null;
  conflict: EntryEditConflict | null;
  /** The draft song differs from the saved entry's. */
  songChanged: boolean;
  /** The draft would change the entry: leaving first asks "Discard changes?". */
  dirty: boolean;
  saving: boolean;
  /** The song was picked just now: its summary may start the preview. */
  autoPlayPreview: boolean;
  manualFormId: string;
  detailsFormId: string;
  lengthFieldId: string;
  manualFieldId: (field: ManualField) => string;
  detailsFieldId: (field: DetailsField) => string;
  changeTerm: (term: string) => void;
  startSearch: () => void;
  keepSong: () => void;
  selectSong: (song: SongResult) => void;
  enterManually: () => void;
  searchUnavailable: () => void;
  changeManual: (field: ManualField, value: string) => void;
  submitManual: () => void;
  changeDetails: (field: DetailsField, value: string) => void;
  changeLength: (value: string) => void;
  save: () => void;
}

/**
 * Runs one edit session of the entry dialog.
 *
 * The draft starts from the entry whenever edit mode opens, and every opening starts fresh. Only
 * the changed fields are PATCHed; the same value leaves the entry alone. Annotation changes are
 * not part of the draft: they save immediately through their own endpoints.
 *
 * @param options - The entry, today, the viewer's auto-play preference and the way out.
 * @returns The draft, its errors and the actions the edit form calls.
 */
export function useEntryEdit({
  active,
  entry,
  today,
  autoPlayPreview,
  onExit,
}: UseEntryEditOptions): EntryEditController {
  const toast = useToast();
  const updateEntry = useUpdateEntry();
  const manualFormId = useId();
  const detailsFormId = useId();
  const [state, setState] = useState<EditState>(EMPTY_EDIT_STATE);
  const [wasActive, setWasActive] = useState(false);

  // Starting a session resets the draft during render (the same adjust-during-render pattern as
  // useOpenSession), so the first render of edit mode already shows the entry's own values.
  let draft = state;
  if (active && !wasActive) {
    setWasActive(true);
    if (entry !== null) {
      draft = initialEditState(entry);
      setState(draft);
    }
  } else if (!active && wasActive) {
    setWasActive(false);
  }

  const manualFieldId = (field: ManualField) => `${manualFormId}-${field}`;
  const detailsFieldId = (field: DetailsField) => `${detailsFormId}-${field}`;
  const lengthFieldId = `${detailsFormId}-duration_ms`;

  const parsedLength = draft.song.source === 'manual' ? checkLength(draft.length) : null;
  const draftSong: SongDraft =
    parsedLength === null ? draft.song : { ...draft.song, duration_ms: parsedLength.value };
  const songChanged = active && entry !== null && !sameSong(draftSong, songFromEntry(entry));
  const dirty =
    active &&
    entry !== null &&
    (hasChanges(entry, draftSong, draft.details) ||
      (draft.song.source === 'manual' && draft.length !== lengthText(entry.duration_ms)));

  const saving = updateEntry.isPending;

  function focusFirst<Field extends string>(
    order: readonly Field[],
    errors: FieldErrorMap<Field>,
    id: (field: Field) => string,
  ): void {
    const first = firstInvalidField(errors, order);
    if (first !== undefined) {
      document.getElementById(id(first))?.focus();
    }
  }

  function changeTerm(term: string): void {
    setState((current) => ({ ...current, term }));
  }

  function startSearch(): void {
    setState((current) => ({ ...current, step: 'search' }));
  }

  function keepSong(): void {
    setState((current) => ({ ...current, step: 'details' }));
  }

  function selectSong(song: SongResult): void {
    setState((current) => ({ ...current, step: 'details', song, picked: true }));
  }

  function enterManually(notice: string | null = null): void {
    setState((current) => ({
      ...current,
      step: 'manual',
      manualNotice: notice,
      manual: hasInput(current.manual)
        ? current.manual
        : current.song.source === 'manual'
          ? manualValuesFromSong(current.song)
          : { ...EMPTY_MANUAL_VALUES, title: current.term.trim() },
    }));
  }

  function searchUnavailable(): void {
    enterManually(SEARCH_UNAVAILABLE_MESSAGE);
  }

  function changeManual(field: ManualField, value: string): void {
    setState((current) => ({
      ...current,
      manual: { ...current.manual, [field]: value },
      manualErrors: withoutField(current.manualErrors, field),
    }));
  }

  function submitManual(): void {
    const { errors, song } = validateManualSong(draft.manual);
    if (song === null) {
      setState((current) => ({ ...current, manualErrors: errors }));
      focusFirst(MANUAL_FIELDS, errors, manualFieldId);
      return;
    }
    setState((current) => ({
      ...current,
      step: 'details',
      song,
      picked: false,
      length: lengthText(song.duration_ms),
    }));
  }

  function changeDetails(field: DetailsField, value: string): void {
    setState((current) => ({
      ...current,
      details: { ...current.details, [field]: value },
      detailsErrors: withoutField(current.detailsErrors, field),
      conflict: field === 'entry_date' ? null : current.conflict,
    }));
  }

  function changeLength(value: string): void {
    setState((current) => ({ ...current, length: value, lengthError: null }));
  }

  function showDetailsErrors(errors: FieldErrorMap<DetailsField>, formError: string | null): void {
    setState((current) => ({ ...current, detailsErrors: errors, formError }));
    focusFirst(DETAILS_FIELDS, errors, detailsFieldId);
  }

  function save(): void {
    if (!active || entry === null || saving) {
      return;
    }
    const { errors, details } = validateDetails(draft.details, today);
    if (details === null) {
      showDetailsErrors(errors, null);
      return;
    }
    let song = draft.song;
    if (song.source === 'manual') {
      const length = checkLength(draft.length);
      if (length.error !== undefined) {
        setState((current) => ({ ...current, lengthError: length.error ?? null }));
        document.getElementById(lengthFieldId)?.focus();
        return;
      }
      song = { ...song, duration_ms: length.value };
    }
    const patch = buildEditPatch(entry, song, details);
    if (Object.keys(patch).length === 0) {
      onExit();
      return;
    }
    updateEntry.mutate(
      { id: entry.id, patch },
      {
        onSuccess: () => {
          toast.show('Saved your changes.', { tone: 'success' });
          onExit();
        },
        onError: (error) => {
          const existingId = existingEntryId(error);
          if (existingId !== null) {
            setState((current) => ({
              ...current,
              conflict: { entryId: existingId, date: details.entry_date },
            }));
            return;
          }
          const songErrors = song.source === 'manual' ? apiFieldErrors(error, MANUAL_FIELDS) : {};
          if (Object.keys(songErrors).length > 0) {
            // The manual form is shown next; its first invalid field takes focus when it opens.
            setState((current) => ({
              ...current,
              step: 'manual',
              manual: manualValuesFromSong(song),
              manualNotice: null,
              manualErrors: songErrors,
            }));
            return;
          }
          const fields = apiFieldErrors(error, DETAILS_FIELDS);
          showDetailsErrors(
            fields,
            Object.keys(fields).length > 0 ? null : describeApiError(error),
          );
        },
      },
    );
  }

  return {
    step: draft.step,
    song: draft.song,
    length: draft.length,
    values: draft.details,
    term: draft.term,
    manual: draft.manual,
    manualNotice: draft.manualNotice,
    manualErrors: draft.manualErrors,
    detailsErrors: draft.detailsErrors,
    lengthError: draft.lengthError,
    formError: draft.formError,
    conflict: draft.conflict,
    songChanged,
    dirty,
    saving,
    autoPlayPreview: draft.picked && autoPlayPreview,
    manualFormId,
    detailsFormId,
    lengthFieldId,
    manualFieldId,
    detailsFieldId,
    changeTerm,
    startSearch,
    keepSong,
    selectSong,
    enterManually,
    searchUnavailable,
    changeManual,
    submitManual,
    changeDetails,
    changeLength,
    save,
  };
}
