/**
 * The entry dialog's edit form: the song summary with "Change song" (the
 * search and manual-entry steps render in its place), the day, the note and the YouTube link,
 * plus the length for manual songs and the day's [Delete entry] button.
 */
import { Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { EntryDetail } from '@/api/types';
import { Alert, FormError } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextArea } from '@/components/ui/TextArea';
import { TextField } from '@/components/ui/TextField';
import { ExternalLink } from '@/features/player/ExternalLink';
import { YouTubeMatchFinder } from '@/features/player/YouTubeMatchFinder';
import { searchUrl, watchUrl } from '@/lib/youtube';

import { EntryConflict } from '../log/EntryConflict';
import { ManualSongStep } from '../log/ManualSongStep';
import { describeDay, notesStayAttachedMessage } from '../log/messages';
import { SongSearchStep } from '../log/SongSearchStep';
import { SongSummary } from '../log/SongSummary';
import {
  MIN_ENTRY_DATE,
  NOTE_MAX_LENGTH,
  URL_MAX_LENGTH,
  type DetailsField,
} from '../log/validation';
import type { EntryEditController } from './useEntryEdit';

export interface EntryEditBodyProps {
  /** The logged-in owner's username (the conflict names the day's entry). */
  username: string;
  /** The saved entry: its note count feeds the song-change warning. */
  entry: EntryDetail;
  /** Today's date: the latest day the date field allows. */
  today: string;
  edit: EntryEditController;
  /** Opens the delete confirmation. */
  onDelete: () => void;
  /** Shows another day's entry after a `409 entry_exists`. */
  onOpenExisting: (entryId: number) => void;
}

/**
 * The in-place edit form. Every step keeps the window's frame: the search and manual-entry steps
 * render in the body's place, and the details step is the form the footer's Save button submits.
 */
export function EntryEditBody({
  username,
  entry,
  today,
  edit,
  onDelete,
  onOpenExisting,
}: EntryEditBodyProps) {
  const { step } = edit;
  const stepRoot = useRef<HTMLDivElement | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const manualTitle = useRef<HTMLInputElement | null>(null);
  const summary = useRef<HTMLElement | null>(null);

  // Each step hands over the element that takes focus when it opens (the search input, the title
  // input or the song summary); an invalid field takes precedence.
  useEffect(() => {
    const invalid = stepRoot.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    const target =
      invalid ??
      (step === 'search'
        ? searchInput.current
        : step === 'manual'
          ? manualTitle.current
          : summary.current);
    target?.focus();
  }, [step]);

  function change(field: DetailsField) {
    return (event: { target: { value: string } }) => {
      edit.changeDetails(field, event.target.value);
    };
  }

  const warning =
    entry.annotation_count > 0 && edit.songChanged
      ? notesStayAttachedMessage(entry.annotation_count)
      : null;
  const conflict = edit.conflict;

  if (step === 'search') {
    return (
      <div ref={stepRoot} className="flex flex-col gap-4">
        <SongSearchStep
          term={edit.term}
          onTermChange={edit.changeTerm}
          onSelect={edit.selectSong}
          onEnterManually={() => {
            edit.enterManually();
          }}
          onUnavailable={edit.searchUnavailable}
          inputRef={(node) => {
            searchInput.current = node;
          }}
        />
      </div>
    );
  }

  if (step === 'manual') {
    return (
      <div ref={stepRoot} className="flex flex-col gap-4">
        <ManualSongStep
          formId={edit.manualFormId}
          values={edit.manual}
          errors={edit.manualErrors}
          fieldId={edit.manualFieldId}
          notice={edit.manualNotice}
          onChange={edit.changeManual}
          onSubmit={edit.submitManual}
          titleRef={(node) => {
            manualTitle.current = node;
          }}
        />
      </div>
    );
  }

  return (
    <div ref={stepRoot}>
      <form
        id={edit.detailsFormId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          edit.save();
        }}
        className="flex flex-col gap-4"
      >
        <SongSummary
          song={edit.song}
          autoPlayPreview={edit.autoPlayPreview}
          showPreview={edit.songChanged}
          onChangeSong={edit.startSearch}
          summaryRef={(node) => {
            summary.current = node;
          }}
        />
        {warning !== null && <Alert tone="info">{warning}</Alert>}
        <TextField
          id={edit.detailsFieldId('entry_date')}
          label="Date"
          type="date"
          required
          min={MIN_ENTRY_DATE}
          max={today}
          value={edit.values.entry_date}
          error={edit.detailsErrors.entry_date}
          onChange={change('entry_date')}
        />
        <TextArea
          id={edit.detailsFieldId('note')}
          label="Note (optional)"
          placeholder="What made it the song of the day?"
          maxLength={NOTE_MAX_LENGTH}
          showCount
          value={edit.values.note}
          error={edit.detailsErrors.note}
          onChange={change('note')}
        />
        <div className="flex flex-col gap-2">
          <TextField
            id={edit.detailsFieldId('youtube_video_id')}
            label="YouTube link (optional)"
            type="url"
            inputMode="url"
            placeholder="https://youtu.be/…"
            hint="Add a YouTube link to take notes while it plays"
            maxLength={URL_MAX_LENGTH}
            autoComplete="off"
            value={edit.values.youtube_video_id}
            error={edit.detailsErrors.youtube_video_id}
            onChange={change('youtube_video_id')}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {edit.song.source === 'itunes' && edit.values.youtube_video_id.trim() === '' && (
              <YouTubeMatchFinder
                song={edit.song}
                onUse={(videoId) => {
                  edit.changeDetails('youtube_video_id', watchUrl(videoId));
                }}
              />
            )}
            <ExternalLink href={searchUrl(edit.song.artist, edit.song.title)} className="text-sm">
              Find on YouTube
            </ExternalLink>
          </div>
        </div>
        {edit.song.source === 'manual' && (
          <TextField
            id={edit.lengthFieldId}
            label="Length (optional)"
            placeholder="3:45"
            hint="m:ss"
            autoComplete="off"
            value={edit.length}
            error={edit.lengthError}
            onChange={(event) => {
              edit.changeLength(event.target.value);
            }}
          />
        )}
        {conflict !== null && (
          <EntryConflict
            username={username}
            entryId={conflict.entryId}
            day={describeDay(conflict.date, today)}
            onOpen={() => {
              onOpenExisting(conflict.entryId);
            }}
          />
        )}
        <FormError message={edit.formError} />
        <div className="border-t border-line pt-4">
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 aria-hidden="true" className="size-4" />}
            onClick={onDelete}
          >
            Delete entry
          </Button>
        </div>
      </form>
    </div>
  );
}
