import { Pencil } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';

import { hasErrorCode } from '@/api/errors';
import { useMe } from '@/api/hooks/auth';
import { useDeleteEntry } from '@/api/hooks/entries';
import { useProfileEntry } from '@/api/hooks/users';
import { describeApiError } from '@/api/messages';
import type { EntryDetail } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Dialog } from '@/components/ui/Dialog';
import { AnnotationPanel } from '@/features/annotations/AnnotationPanel';
import { ENTRY_PARAM } from '@/features/profile/searchParams';
import { PlayerArea } from '@/features/player/PlayerArea';
import { useYouTubePlayer } from '@/features/player/useYouTubePlayer';
import { useToday } from '@/hooks/useToday';
import { formatDisplayDate } from '@/lib/dates';

import { EntryDetailSkeleton, EntryLoadError, EntryNotFound } from './EntryDetailStates';
import { EntryEditBody } from './EntryEditBody';
import { EntryMeta } from './EntryMeta';
import { ListenOnRow } from './ListenOnRow';
import { DETAIL_GRID_CLASS_NAME } from './layout';
import { deleteEntryMessage } from './messages';
import { useEntryEdit } from './useEntryEdit';

/** Where a way out of edit mode leads: back to view mode, or out of the dialog. */
type Exit = 'view' | 'close';

export interface EntryDetailWindowProps {
  username: string;
  entryId: number;
  onClose: () => void;
  readOnly: boolean;
}

/** The entry's note, in view mode. Its own component keeps the player at a stable slot. */
function EntryNote({ entry }: { entry: EntryDetail }) {
  if (entry.note === null) {
    return null;
  }
  return <p className="text-base break-words whitespace-pre-line text-fg">{entry.note}</p>;
}

/**
 * The open entry dialog: loads the entry (through the public endpoint) and shows it in view mode
 * — artwork, details, the "Listen on" row, the note, the player and the annotation timeline. The
 * owner can switch the same window into edit mode in place ([Edit] then [Cancel]/[Save]); the
 * player and the timeline stay mounted, so a playing video keeps playing.
 * Shows a skeleton while loading, a notice when the entry doesn't exist, and a retry otherwise.
 */
export function EntryDetailWindow({
  username,
  entryId,
  onClose,
  readOnly,
}: EntryDetailWindowProps) {
  const query = useProfileEntry(username, entryId);
  // Logged-out visitors never get auto-play; a logged-in viewer gets their own preference.
  const autoPlay = useMe().data?.autoplay_previews === true;
  const today = useToday();
  const deleteEntry = useDeleteEntry();
  const [, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /** Which way out the discard confirmation takes when the user confirms. */
  const [discardThen, setDiscardThen] = useState<Exit | null>(null);
  // Shown while the entry is deleted, so the dialog doesn't flash "doesn't exist" before closing.
  const [deleted, setDeleted] = useState<EntryDetail | null>(null);
  const entry = deleted ?? query.data;
  const notFound = entry === undefined && hasErrorCode(query.error, 'not_found');
  const player = useYouTubePlayer(entry?.youtube_video_id ?? null, { autoPlay });
  const leaveEdit = useCallback(() => {
    setEditing(false);
  }, []);
  const edit = useEntryEdit({
    active: entry !== undefined && editing,
    entry: entry ?? null,
    today,
    autoPlayPreview: autoPlay,
    onExit: leaveEdit,
  });

  function confirmDelete(target: EntryDetail) {
    setDeleted(target);
    deleteEntry.mutate(target.id, {
      onSuccess: onClose,
      onError: () => {
        setDeleted(null);
      },
    });
  }

  /** Leaves edit mode, or closes the dialog; unsaved changes are confirmed first. */
  function requestExit(then: Exit) {
    if (edit.dirty) {
      setDiscardThen(then);
      return;
    }
    if (then === 'close') {
      onClose();
    } else {
      setEditing(false);
    }
  }

  function openExisting(id: number) {
    setEditing(false);
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      next.set(ENTRY_PARAM, String(id));
      return next;
    });
  }

  let title = 'song details';
  let body: ReactNode = <EntryDetailSkeleton />;
  let footer: ReactNode;
  if (entry !== undefined) {
    title = formatDisplayDate(entry.entry_date);
    body = (
      <div className={DETAIL_GRID_CLASS_NAME}>
        <EntryMeta entry={entry} listenOn={editing ? undefined : <ListenOnRow entry={entry} />} />
        <div className="flex min-w-0 flex-col gap-6">
          {/*
            One slot holds the note or the edit form, so the player area and the annotation panel
            below it keep their positions and stay mounted across the mode switch.
          */}
          {editing ? (
            <EntryEditBody
              username={username}
              entry={entry}
              today={today}
              edit={edit}
              onDelete={() => {
                deleteEntry.reset();
                setConfirmingDelete(true);
              }}
              onOpenExisting={openExisting}
            />
          ) : (
            <EntryNote entry={entry} />
          )}
          <PlayerArea entry={entry} player={player} autoPlay={autoPlay} />
          <AnnotationPanel entry={entry} player={player} readOnly={readOnly || !editing} />
        </div>
      </div>
    );
    if (editing) {
      if (edit.step === 'search') {
        footer = (
          <Button variant="secondary" onClick={edit.keepSong}>
            Keep current song
          </Button>
        );
      } else if (edit.step === 'manual') {
        footer = (
          <>
            <Button variant="secondary" onClick={edit.startSearch}>
              Back to search
            </Button>
            <Button type="submit" form={edit.manualFormId}>
              Continue
            </Button>
          </>
        );
      } else {
        footer = (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                requestExit('view');
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form={edit.detailsFormId} loading={edit.saving}>
              Save
            </Button>
          </>
        );
      }
    } else if (!readOnly) {
      footer = (
        <Button
          variant="secondary"
          size="sm"
          icon={<Pencil aria-hidden="true" className="size-4" />}
          onClick={() => {
            setEditing(true);
          }}
        >
          Edit
        </Button>
      );
    }
  } else if (notFound) {
    body = <EntryNotFound />;
    footer = (
      <Button variant="secondary" size="sm" onClick={onClose}>
        Close
      </Button>
    );
  } else if (query.isError) {
    body = (
      <EntryLoadError
        error={query.error}
        retrying={query.isFetching}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          requestExit('close');
        }
      }}
      title={title}
      // The footer's Close replaces the title bar's, so there is one "Close" button.
      hideCloseButton={notFound}
      size="lg"
      className="md:max-w-4xl lg:max-w-5xl"
      footer={footer}
    >
      {body}
      {entry !== undefined && !readOnly && (
        <>
          <ConfirmDialog
            open={confirmingDelete}
            onOpenChange={setConfirmingDelete}
            title="Delete entry"
            message={deleteEntryMessage(entry.annotation_count)}
            confirmLabel="Delete"
            destructive
            pending={deleteEntry.isPending}
            error={deleteEntry.isError ? describeApiError(deleteEntry.error) : null}
            onConfirm={() => {
              confirmDelete(entry);
            }}
          />
          <ConfirmDialog
            open={discardThen !== null}
            onOpenChange={(open) => {
              if (!open) {
                setDiscardThen(null);
              }
            }}
            title="Discard changes?"
            message="Your changes to this song will be lost."
            confirmLabel="Discard"
            cancelLabel="Keep editing"
            destructive
            onConfirm={() => {
              const then = discardThen;
              setDiscardThen(null);
              if (then === 'close') {
                onClose();
              } else {
                setEditing(false);
              }
            }}
          />
        </>
      )}
    </Dialog>
  );
}
