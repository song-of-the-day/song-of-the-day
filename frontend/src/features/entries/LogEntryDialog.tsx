import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';

import { existingEntryId } from '@/api/errors';
import { useMe } from '@/api/hooks/auth';
import { useCreateEntry, useUpdateEntry } from '@/api/hooks/entries';
import { useYouTubeMatch } from '@/api/hooks/songs';
import { describeApiError } from '@/api/messages';
import type { Entry, EntryDetail } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/useToast';
import { useFormErrors } from '@/features/auth/useFormErrors';
import { apiFieldErrors } from '@/features/auth/validation';
import { matchTrack } from '@/features/player/matchTrack';
import { ENTRY_PARAM } from '@/features/profile/searchParams';
import { useToday } from '@/hooks/useToday';
import { isIsoDate } from '@/lib/dates';
import { watchUrl } from '@/lib/youtube';

import { DetailsStep } from './log/DetailsStep';
import { EntryConflict } from './log/EntryConflict';
import { ManualSongStep } from './log/ManualSongStep';
import { describeDay, SEARCH_UNAVAILABLE_MESSAGE } from './log/messages';
import { buildCreateInput, buildReplacePatch } from './log/payloads';
import { type SongDraft } from './log/songDraft';
import { SongSearchStep } from './log/SongSearchStep';
import { useOpenSession } from './log/useOpenSession';
import {
  DETAILS_FIELDS,
  EMPTY_MANUAL_VALUES,
  MANUAL_FIELDS,
  manualValuesFromSong,
  validateDetails,
  validateManualSong,
  type DetailsField,
  type DetailsValues,
  type EntryDetails,
  type ManualField,
  type ManualValues,
} from './log/validation';

export interface LogEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The date the form starts on (yyyy-MM-dd). When absent the date field starts empty and the
   * user must pick a day ("Log a day"); today's button and a clicked calendar day pass one.
   */
  initialDate?: string;
  /** Called after a successful create/replace with the saved entry. */
  onSaved?: (entry: EntryDetail) => void;
  /** Called when the user picks "Open it" after a 409 entry_exists. */
  onOpenExisting?: (entryId: number) => void;
}

type Step = 'search' | 'manual' | 'details';

/** A `409 entry_exists`: the day already has an entry. */
interface Conflict {
  entryId: number;
  date: string;
}

function hasInput(values: ManualValues): boolean {
  return Object.values(values).some((value) => value !== '');
}

/**
 * Logs a song for a day.
 *
 * It searches iTunes (or takes a manually typed song), then asks for the day, a note and a
 * YouTube link. Editing an entry happens in the entry dialog's own edit mode. Each opening starts
 * from a clean slate.
 */
export function LogEntryDialog(props: LogEntryDialogProps) {
  const session = useOpenSession(props.open);
  return <LogEntrySession key={session} {...props} />;
}

function LogEntrySession({
  open,
  onOpenChange,
  initialDate,
  onSaved,
  onOpenExisting,
}: LogEntryDialogProps) {
  const today = useToday();
  const toast = useToast();
  const me = useMe().data;
  const [, setSearchParams] = useSearchParams();
  const createEntry = useCreateEntry();
  const updateEntry = useUpdateEntry();
  const manualFormId = useId();
  const detailsFormId = useId();
  const manualForm = useFormErrors(MANUAL_FIELDS);
  const detailsForm = useFormErrors(DETAILS_FIELDS);

  const [openedDate] = useState(() => initialDate ?? '');
  const [step, setStep] = useState<Step>('search');
  const [song, setSong] = useState<SongDraft | null>(null);
  const [term, setTerm] = useState('');
  /** The song was just picked from search results, so its preview may auto-play. */
  const [picked, setPicked] = useState(false);
  const [manualValues, setManualValues] = useState<ManualValues>(EMPTY_MANUAL_VALUES);
  const [manualNotice, setManualNotice] = useState<string | null>(null);
  const [details, setDetails] = useState<DetailsValues>({
    entry_date: openedDate,
    note: '',
    youtube_video_id: '',
  });
  const [conflict, setConflict] = useState<Conflict | null>(null);
  /** The matched video the user rejected; its suggestion stays hidden for this dialog. */
  const [rejectedVideoId, setRejectedVideoId] = useState<string | null>(null);
  const saving = createEntry.isPending || updateEntry.isPending;

  // The background YouTube lookup: only for an iTunes song whose YouTube
  // field is still empty. A cached answer shows immediately; no key configured means silence.
  const autoMatchTrack = useMemo(
    () => (song !== null && song.source === 'itunes' ? matchTrack(song) : null),
    [song],
  );
  const autoMatch = useYouTubeMatch(autoMatchTrack, {
    enabled: step === 'details' && details.youtube_video_id.trim() === '',
  });
  const suggested = autoMatch.data?.match ?? null;
  /** The suggested video, while the user has not typed a link of their own. */
  const shownMatch =
    suggested !== null && suggested.video_id !== rejectedVideoId && details.youtube_video_id === ''
      ? suggested
      : null;
  /**
   * The details form's values: the matched link counts as the field's text (and as the saved
   * `youtube_video_id`), so nothing has to be copied into state.
   */
  const shownDetails =
    shownMatch === null ? details : { ...details, youtube_video_id: watchUrl(shownMatch.video_id) };

  // Each step hands over the element that takes focus when it opens (the search input, the
  // title input or the song summary); an invalid field takes precedence.
  const stepRoot = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<HTMLElement | null>(null);
  const focusPending = useRef(false);
  const setFocusTarget = useCallback((node: HTMLElement | null) => {
    focusTarget.current = node;
  }, []);

  useEffect(() => {
    if (!focusPending.current) {
      return;
    }
    focusPending.current = false;
    const invalid = stepRoot.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    (invalid ?? focusTarget.current)?.focus();
  }, [step]);

  function goTo(next: Step) {
    focusPending.current = true;
    setStep(next);
  }

  function finish(saved: EntryDetail, message: string) {
    toast.show(message, { tone: 'success' });
    onSaved?.(saved);
    onOpenChange(false);
  }

  function chooseSong(next: SongDraft, fromSearch = false) {
    setSong(next);
    setPicked(fromSearch);
    goTo('details');
  }

  function openManual(notice: string | null) {
    setManualNotice(notice);
    if (!hasInput(manualValues)) {
      setManualValues(
        song?.source === 'manual'
          ? manualValuesFromSong(song)
          : { ...EMPTY_MANUAL_VALUES, title: term.trim() },
      );
    }
    goTo('manual');
  }

  function changeManual(field: ManualField, value: string) {
    setManualValues((current) => ({ ...current, [field]: value }));
    manualForm.clearField(field);
  }

  function submitManual() {
    const { errors, song: manualSong } = validateManualSong(manualValues);
    if (!manualForm.showErrors(errors) && manualSong !== null) {
      chooseSong(manualSong);
    }
  }

  function changeDetails(field: DetailsField, value: string) {
    setDetails((current) => ({ ...current, [field]: value }));
    detailsForm.clearField(field);
    if (field === 'entry_date') {
      setConflict(null);
    }
  }

  /** Rejects the suggested video: the field goes back to empty and the line disappears. */
  function dismissMatch() {
    if (shownMatch === null) {
      return;
    }
    setRejectedVideoId(shownMatch.video_id);
  }

  /** Shows a failed save: song field errors on the manual form, the rest on the details form. */
  function showSaveError(error: unknown, chosen: SongDraft) {
    const songErrors = chosen.source === 'manual' ? apiFieldErrors(error, MANUAL_FIELDS) : {};
    if (Object.keys(songErrors).length > 0) {
      setManualValues(manualValuesFromSong(chosen));
      setManualNotice(null);
      manualForm.showErrors(songErrors);
      goTo('manual');
      return;
    }
    const fields = apiFieldErrors(error, DETAILS_FIELDS);
    detailsForm.showErrors(fields, Object.keys(fields).length > 0 ? null : describeApiError(error));
  }

  function handleSaveError(error: unknown, chosen: SongDraft, date: string) {
    const existingId = existingEntryId(error);
    if (existingId === null) {
      showSaveError(error, chosen);
    } else {
      setConflict({ entryId: existingId, date });
    }
  }

  function validDetails(): EntryDetails | null {
    const { errors, details: parsed } = validateDetails(shownDetails, today);
    return detailsForm.showErrors(errors) ? null : parsed;
  }

  function save() {
    const parsed = validDetails();
    if (song === null || parsed === null || saving) {
      return;
    }
    setConflict(null);
    createEntry.mutate(buildCreateInput(song, parsed), {
      onSuccess: (saved) => {
        finish(saved, `Logged ${saved.title} for ${describeDay(saved.entry_date, today)}.`);
      },
      onError: (error) => {
        handleSaveError(error, song, parsed.entry_date);
      },
    });
  }

  function replaceExisting(existing: Entry | undefined) {
    const parsed = validDetails();
    if (conflict === null || song === null || parsed === null || saving) {
      return;
    }
    updateEntry.mutate(
      { id: conflict.entryId, patch: buildReplacePatch(song, parsed, existing) },
      {
        onSuccess: (saved) => {
          finish(saved, `Replaced the song for ${describeDay(saved.entry_date, today)}.`);
        },
        onError: (error) => {
          showSaveError(error, song);
        },
      },
    );
  }

  function openExisting(entryId: number) {
    if (onOpenExisting === undefined) {
      setSearchParams((params) => {
        const next = new URLSearchParams(params);
        next.set(ENTRY_PARAM, String(entryId));
        return next;
      });
    } else {
      onOpenExisting(entryId);
    }
    onOpenChange(false);
  }

  const shownDate = [details.entry_date, openedDate].find(isIsoDate);
  const description =
    shownDate === undefined ? undefined : `Logging for ${describeDay(shownDate, today)}`;

  let body: ReactNode = null;
  let footer: ReactNode;
  if (step === 'search') {
    body = (
      <SongSearchStep
        term={term}
        onTermChange={setTerm}
        onSelect={(next) => {
          chooseSong(next, true);
        }}
        onEnterManually={() => {
          openManual(null);
        }}
        onUnavailable={() => {
          openManual(SEARCH_UNAVAILABLE_MESSAGE);
        }}
        inputRef={setFocusTarget}
      />
    );
    footer =
      song === null ? undefined : (
        <Button
          variant="secondary"
          onClick={() => {
            goTo('details');
          }}
        >
          Keep current song
        </Button>
      );
  } else if (step === 'manual') {
    body = (
      <ManualSongStep
        formId={manualFormId}
        values={manualValues}
        errors={manualForm.errors}
        fieldId={manualForm.fieldId}
        notice={manualNotice}
        onChange={changeManual}
        onSubmit={submitManual}
        titleRef={setFocusTarget}
      />
    );
    footer = (
      <>
        <Button
          variant="secondary"
          onClick={() => {
            goTo('search');
          }}
        >
          Back to search
        </Button>
        <Button type="submit" form={manualFormId}>
          Continue
        </Button>
      </>
    );
  } else if (song !== null) {
    body = (
      <DetailsStep
        formId={detailsFormId}
        song={song}
        autoPlayPreview={picked && me?.autoplay_previews === true}
        values={shownDetails}
        errors={detailsForm.errors}
        fieldId={detailsForm.fieldId}
        today={today}
        conflict={
          conflict !== null &&
          me !== undefined &&
          me !== null && (
            <EntryConflict
              username={me.username}
              entryId={conflict.entryId}
              day={describeDay(conflict.date, today)}
              replacement={song}
              replacing={updateEntry.isPending}
              onOpen={() => {
                openExisting(conflict.entryId);
              }}
              onReplace={replaceExisting}
            />
          )
        }
        match={shownMatch}
        onDismissMatch={dismissMatch}
        formError={detailsForm.formError}
        onChange={changeDetails}
        onChangeSong={() => {
          goTo('search');
        }}
        onSubmit={save}
        summaryRef={setFocusTarget}
      />
    );
    footer = (
      <>
        <Button
          variant="secondary"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          Cancel
        </Button>
        <Button type="submit" form={detailsFormId} loading={saving}>
          Save
        </Button>
      </>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="log a song"
      description={description}
      footer={footer}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        focusTarget.current?.focus();
      }}
    >
      <div ref={stepRoot}>{body}</div>
    </Dialog>
  );
}
