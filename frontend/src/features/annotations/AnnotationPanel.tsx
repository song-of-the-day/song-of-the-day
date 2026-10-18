import { Plus, StickyNote as StickyNoteIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { useDeleteAnnotation } from '@/api/hooks/annotations';
import { describeApiError } from '@/api/messages';
import type { Annotation, EntryDetail } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { YouTubePlayerController } from '@/features/player/useYouTubePlayer';
import { PLAYER_STATE } from '@/features/player/youtube';
import { formatMs } from '@/lib/time';

import { AnnotationForm } from './AnnotationForm';
import { AnnotationList } from './AnnotationList';
import { AnnotationTimeline } from './AnnotationTimeline';
import { formatNoteTime, notesAt, timelineScale } from './timeline';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const NOTHING_PLAYING: ReadonlySet<number> = new Set();

export const EMPTY_NOTES_MESSAGE = 'No notes yet. Pin a thought to a moment you love.';
export const EMPTY_NOTES_READ_ONLY_MESSAGE = 'No notes on this one.';

export interface AnnotationPanelProps {
  entry: EntryDetail;
  /** The entry's YouTube player (not ready when there is no video). */
  player: YouTubePlayerController;
  /**
   * Visitor mode: the timeline, seeking and notes still work, but nothing can be added, edited
   * or deleted, and no YouTube link can be attached.
   */
  readOnly?: boolean;
}

type FormState =
  | { mode: 'create'; key: number; startMs: number | null; endMs: number | null }
  | { mode: 'edit'; id: number };

/** A note picked on the timeline; a new object for every pick, so it scrolls each time. */
interface Selection {
  id: number;
}

/**
 * The entry's "sticky notes in the margins": the timeline, the note form and the notes.
 * With a ready YouTube player the playhead moves, notes can be added at
 * the current time, picking a note seeks to it and playing notes are highlighted. Without a
 * video it offers to attach one; notes can always be added by typing times.
 */
export function AnnotationPanel({ entry, player, readOnly = false }: AnnotationPanelProps) {
  const headingId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [deleting, setDeleting] = useState<Annotation | null>(null);
  const deleteAnnotation = useDeleteAnnotation();

  const { annotations } = entry;
  // A failed player counts as no player: its duration and position are not used.
  const scale = timelineScale(player.ready ? player.durationMs : 0, entry.duration_ms, annotations);
  const playing = player.ready && player.state === PLAYER_STATE.PLAYING;
  const playingIds = playing ? notesAt(annotations, player.currentTimeMs) : NOTHING_PLAYING;
  const editingId = form?.mode === 'edit' ? form.id : null;
  const editing = annotations.find((annotation) => annotation.id === editingId);

  useEffect(() => {
    if (selection === null) {
      return;
    }
    const smooth = !window.matchMedia(REDUCED_MOTION_QUERY).matches;
    listRef.current
      ?.querySelector(`[data-note-id="${String(selection.id)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
  }, [selection]);

  function openCreate(startMs: number | null, endMs: number | null) {
    setForm((current) => ({
      mode: 'create',
      key: (current?.mode === 'create' ? current.key : 0) + 1,
      startMs,
      endMs,
    }));
  }

  function select(annotation: Annotation) {
    setSelection({ id: annotation.id });
  }

  /** Seeks a ready player to the note (the controller ignores seeks otherwise) and selects it. */
  function seekToNote(annotation: Annotation) {
    player.seekTo(annotation.start_ms);
    select(annotation);
  }

  function handleSaved(annotation: Annotation) {
    setForm(null);
    select(annotation);
  }

  function confirmDelete() {
    if (deleting === null) {
      return;
    }
    deleteAnnotation.mutate(
      { entryId: entry.id, id: deleting.id },
      {
        onSuccess: () => {
          setDeleting(null);
        },
      },
    );
  }

  const formProps = {
    entryId: entry.id,
    onSaved: handleSaved,
    onCancel: () => {
      setForm(null);
    },
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="y2k-sparkle font-heading text-base text-fg">
          notes
        </h3>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            {player.ready && (
              <Button
                variant="secondary"
                size="sm"
                icon={<StickyNoteIcon aria-hidden="true" className="size-4" />}
                onClick={() => {
                  // Whole seconds, like the m:ss the form shows.
                  openCreate(Math.floor(player.getCurrentTimeMs() / 1000) * 1000, null);
                }}
              >
                Note at {formatMs(player.currentTimeMs)}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => {
                openCreate(null, null);
              }}
            >
              Add a note
            </Button>
          </div>
        )}
      </div>
      <AnnotationTimeline
        annotations={annotations}
        lengthMs={scale.lengthMs}
        draggable={scale.real}
        playheadMs={player.ready ? player.currentTimeMs : null}
        playingIds={playingIds}
        selectedId={selection?.id ?? null}
        onSelectNote={seekToNote}
        onSelectRange={readOnly ? undefined : openCreate}
      />
      {!readOnly && form?.mode === 'create' && (
        <div className="y2k-window p-3 sm:p-4">
          <AnnotationForm
            key={form.key}
            initialStartMs={form.startMs}
            initialEndMs={form.endMs}
            {...formProps}
          />
        </div>
      )}
      {annotations.length === 0 ? (
        <p className="text-sm text-muted">
          {readOnly ? EMPTY_NOTES_READ_ONLY_MESSAGE : EMPTY_NOTES_MESSAGE}
        </p>
      ) : (
        <AnnotationList
          ref={listRef}
          annotations={annotations}
          playingIds={playingIds}
          selectedId={selection?.id ?? null}
          canPlay={player.ready}
          editingId={editing === undefined ? null : editing.id}
          editor={editing !== undefined && <AnnotationForm annotation={editing} {...formProps} />}
          onPlay={seekToNote}
          actions={
            readOnly
              ? undefined
              : {
                  onEdit: (annotation) => {
                    setForm({ mode: 'edit', id: annotation.id });
                  },
                  onDelete: (annotation) => {
                    deleteAnnotation.reset();
                    setDeleting(annotation);
                  },
                }
          }
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
          }
        }}
        title="Delete note"
        message={deleting === null ? undefined : `Delete the note at ${formatNoteTime(deleting)}?`}
        confirmLabel="Delete"
        destructive
        pending={deleteAnnotation.isPending}
        error={deleteAnnotation.isError ? describeApiError(deleteAnnotation.error) : null}
        onConfirm={confirmDelete}
      />
    </section>
  );
}
