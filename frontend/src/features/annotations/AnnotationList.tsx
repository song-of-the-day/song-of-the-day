import type { ReactNode, Ref } from 'react';

import { sortAnnotations } from '@/api/hooks/annotations';
import type { Annotation } from '@/api/types';

import { StickyNote, type StickyNoteActions } from './StickyNote';

export interface AnnotationListProps {
  annotations: readonly Annotation[];
  /** Notes containing the playback position. */
  playingIds: ReadonlySet<number>;
  selectedId: number | null;
  /** A ready player can jump to a note. */
  canPlay: boolean;
  /** The note being edited; `editor` is shown in its place. */
  editingId: number | null;
  editor?: ReactNode;
  onPlay: (annotation: Annotation) => void;
  /** Each note's edit/delete actions; omitted when read-only. */
  actions?: StickyNoteActions;
  ref?: Ref<HTMLOListElement>;
}

/**
 * The entry's notes as a wall of sticky notes, ordered by time. Each item carries
 * `data-note-id`, so the timeline can scroll to it.
 */
export function AnnotationList({
  annotations,
  playingIds,
  selectedId,
  canPlay,
  editingId,
  editor,
  onPlay,
  actions,
  ref,
}: AnnotationListProps) {
  return (
    <ol
      ref={ref}
      aria-label="Notes"
      className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-4 gap-y-6 p-0 pt-2"
    >
      {sortAnnotations(annotations).map((annotation) =>
        annotation.id === editingId ? (
          <li
            key={annotation.id}
            data-note-id={annotation.id}
            className="y2k-window col-span-full scroll-m-4 p-3 sm:p-4"
          >
            {editor}
          </li>
        ) : (
          <StickyNote
            key={annotation.id}
            annotation={annotation}
            playing={playingIds.has(annotation.id)}
            selected={annotation.id === selectedId}
            canPlay={canPlay}
            onPlay={onPlay}
            actions={actions}
          />
        ),
      )}
    </ol>
  );
}
