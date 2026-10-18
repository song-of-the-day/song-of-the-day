import { Pencil, Play, Trash2 } from 'lucide-react';

import type { Annotation } from '@/api/types';
import { cn } from '@/lib/cn';

import { noteColorStyle } from './noteColors';
import { formatNoteTime } from './timeline';

/** Buttons on a note inherit the note ink (never the theme text color). */
const NOTE_BUTTON_CLASS_NAME =
  'inline-flex items-center justify-center gap-1 rounded-full hover:bg-current/10 active:bg-current/15';

export interface StickyNoteProps {
  annotation: Annotation;
  /** The note contains the playback position. */
  playing: boolean;
  /** The note was picked on the timeline. */
  selected: boolean;
  /** A ready player can jump to the note. */
  canPlay: boolean;
  onPlay: (annotation: Annotation) => void;
  /** Edit/delete actions; omitted when read-only (visitor mode). */
  actions?: StickyNoteActions;
}

export interface StickyNoteActions {
  onEdit: (annotation: Annotation) => void;
  onDelete: (annotation: Annotation) => void;
}

/**
 * One annotation as a sticky note: its pastel color, note-ink text, a strip
 * of tape and a slight tilt that alternates between notes (none under reduced motion). The time
 * label plays from the note when the player is ready.
 */
export function StickyNote({
  annotation,
  playing,
  selected,
  canPlay,
  onPlay,
  actions,
}: StickyNoteProps) {
  const time = formatNoteTime(annotation);
  return (
    <li
      data-note-id={annotation.id}
      aria-current={playing ? 'time' : undefined}
      style={noteColorStyle(annotation.color)}
      className={cn(
        'y2k-note flex min-w-0 scroll-m-4 flex-col gap-2 motion-reduce:rotate-0',
        playing && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
        selected && 'outline-2 outline-offset-4 outline-accent outline-dashed',
      )}
    >
      <div className="flex min-h-8 items-center justify-between gap-2">
        {canPlay ? (
          <button
            type="button"
            aria-label={`Play from ${time}`}
            className={cn(NOTE_BUTTON_CLASS_NAME, '-ml-1.5 min-h-8 px-1.5 text-xs font-semibold')}
            onClick={() => {
              onPlay(annotation);
            }}
          >
            <Play aria-hidden="true" className="size-3.5" />
            <span className="tabular-nums">{time}</span>
          </button>
        ) : (
          <span className="text-xs font-semibold tabular-nums">{time}</span>
        )}
        {playing && (
          <span className="text-xs font-semibold">
            <span aria-hidden="true">♪ </span>now playing
          </span>
        )}
      </div>
      <p className="text-sm break-words whitespace-pre-line">{annotation.body}</p>
      {actions !== undefined && (
        <div className="-mr-1.5 -mb-1.5 flex justify-end gap-0.5">
          <button
            type="button"
            aria-label={`Edit note at ${time}`}
            title="Edit"
            className={cn(NOTE_BUTTON_CLASS_NAME, 'size-8')}
            onClick={() => {
              actions.onEdit(annotation);
            }}
          >
            <Pencil aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            aria-label={`Delete note at ${time}`}
            title="Delete"
            className={cn(NOTE_BUTTON_CLASS_NAME, 'size-8')}
            onClick={() => {
              actions.onDelete(annotation);
            }}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </button>
        </div>
      )}
    </li>
  );
}
