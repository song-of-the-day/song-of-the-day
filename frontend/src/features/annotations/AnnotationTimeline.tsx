import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { sortAnnotations } from '@/api/hooks/annotations';
import type { Annotation } from '@/api/types';
import { cn } from '@/lib/cn';
import { formatMs } from '@/lib/time';

import { noteColorStyle } from './noteColors';
import {
  assignLanes,
  formatNoteTime,
  generateTicks,
  MIN_RANGE_MS,
  msToPercent,
  pointerToMs,
} from './timeline';

const LANE_HEIGHT_PX = 16;
const TRACK_PADDING_PX = 8;
const EXCERPT_LENGTH = 80;

export const DRAG_HINT = 'Drag across the timeline to highlight a part.';
export const APPROXIMATE_HINT = "The song's length isn't known, so the timeline is approximate.";

export interface AnnotationTimelineProps {
  annotations: readonly Annotation[];
  lengthMs: number;
  /** The length is real (player or entry duration), so dragging selects a range. */
  draggable: boolean;
  /** The playhead position, or `null` without a ready player. */
  playheadMs: number | null;
  /** Notes containing the playback position. */
  playingIds: ReadonlySet<number>;
  selectedId: number | null;
  onSelectNote: (annotation: Annotation) => void;
  /**
   * A drag across the track selected this range (whole seconds, at least one second long).
   * Omit it (read-only) to turn dragging off.
   */
  onSelectRange?: (startMs: number, endMs: number) => void;
}

interface Drag {
  pointerId: number;
  anchorMs: number;
  currentMs: number;
}

function excerpt(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > EXCERPT_LENGTH ? `${line.slice(0, EXCERPT_LENGTH - 1)}…` : line;
}

/** Keeps a note's tooltip inside the track near either end. */
function tooltipAlignment(percent: number): string {
  if (percent < 15) {
    return 'left-0';
  }
  if (percent > 85) {
    return 'right-0';
  }
  return 'left-1/2 -translate-x-1/2';
}

function tickLabelAlignment(percent: number): string {
  if (percent === 0) {
    return '';
  }
  return percent > 94 ? '-translate-x-full' : '-translate-x-1/2';
}

/**
 * The song as a horizontal track with its notes: ranges in the note color at 70% opacity, points
 * as solid pins, both outlined in the text color, spread over rows when they overlap. Hovering
 * or focusing a note shows its text; clicking it selects it. The notes form one tab stop (arrow
 * keys, Home and End move between them). With a real length, dragging across the empty track
 * selects a range for a new note; keyboard users use the note form instead.
 */
export function AnnotationTimeline({
  annotations,
  lengthMs,
  draggable,
  playheadMs,
  playingIds,
  selectedId,
  onSelectNote,
  onSelectRange,
}: AnnotationTimelineProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const markersRef = useRef<HTMLDivElement>(null);
  const notes = sortAnnotations(annotations);
  const { lanes, count } = assignLanes(notes, lengthMs);
  const ticks = generateTicks(lengthMs);
  const canDrag = draggable && onSelectRange !== undefined;
  const rovingIndex = Math.min(focusIndex, notes.length - 1);

  function positionOf(event: PointerEvent<HTMLDivElement>): number {
    return pointerToMs(event.clientX, event.currentTarget.getBoundingClientRect(), lengthMs);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!canDrag || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const ms = positionOf(event);
    setDrag({ pointerId: event.pointerId, anchorMs: ms, currentMs: ms });
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (drag?.pointerId === event.pointerId) {
      setDrag({ ...drag, currentMs: positionOf(event) });
    }
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (drag?.pointerId !== event.pointerId) {
      return;
    }
    const ms = positionOf(event);
    setDrag(null);
    const start = Math.min(drag.anchorMs, ms);
    const end = Math.max(drag.anchorMs, ms);
    if (end - start >= MIN_RANGE_MS) {
      onSelectRange?.(start, end);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = notes.length - 1;
    const targets: Record<string, number> = {
      ArrowRight: Math.min(last, rovingIndex + 1),
      ArrowLeft: Math.max(0, rovingIndex - 1),
      Home: 0,
      End: last,
    };
    const next = targets[event.key];
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    setFocusIndex(next);
    markersRef.current?.querySelectorAll<HTMLButtonElement>('[data-marker]')[next]?.focus();
  }

  const selection =
    drag === null
      ? null
      : {
          start: Math.min(drag.anchorMs, drag.currentMs),
          end: Math.max(drag.anchorMs, drag.currentMs),
        };
  const hint = draggable ? (canDrag ? DRAG_HINT : null) : APPROXIMATE_HINT;

  return (
    <div className="flex flex-col gap-1">
      <div
        className="relative rounded-sm border border-muted bg-surface select-none"
        style={{ height: `${String(TRACK_PADDING_PX * 2 + count * LANE_HEIGHT_PX)}px` }}
      >
        {ticks.map((tick) => (
          <span
            key={tick}
            aria-hidden="true"
            className="absolute bottom-0 h-1.5 w-px bg-line"
            style={{ left: `${String(msToPercent(tick, lengthMs))}%` }}
          />
        ))}
        <div
          role="presentation"
          aria-hidden="true"
          data-drag-surface
          className={cn('absolute inset-0', canDrag && 'cursor-crosshair touch-none')}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            setDrag(null);
          }}
        />
        {selection !== null && selection.end > selection.start && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-1 border border-dashed border-accent bg-accent/15"
            style={{
              left: `${String(msToPercent(selection.start, lengthMs))}%`,
              width: `${String(msToPercent(selection.end - selection.start, lengthMs))}%`,
            }}
          >
            <span className="absolute bottom-full left-0 mb-1 rounded-sm bg-surface px-1 text-xs whitespace-nowrap text-fg tabular-nums">
              {formatMs(selection.start)}–{formatMs(selection.end)}
            </span>
          </div>
        )}
        {playheadMs !== null && (
          <div
            aria-hidden="true"
            data-playhead
            className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-accent motion-safe:transition-[left] motion-safe:duration-300 motion-safe:ease-linear"
            style={{ left: `${String(msToPercent(playheadMs, lengthMs))}%` }}
          >
            <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-accent" />
          </div>
        )}
        {notes.length > 0 && (
          <div
            ref={markersRef}
            role="toolbar"
            aria-label="Notes on the timeline"
            className="pointer-events-none absolute inset-0"
            onKeyDown={handleKeyDown}
          >
            {notes.map((annotation, index) => {
              const left = msToPercent(annotation.start_ms, lengthMs);
              const top =
                TRACK_PADDING_PX +
                (lanes.get(annotation.id) ?? 0) * LANE_HEIGHT_PX +
                LANE_HEIGHT_PX / 2;
              const width =
                annotation.end_ms === null ? null : msToPercent(annotation.end_ms, lengthMs) - left;
              const time = formatNoteTime(annotation);
              return (
                <button
                  key={annotation.id}
                  type="button"
                  data-marker
                  tabIndex={index === rovingIndex ? 0 : -1}
                  aria-label={`${time}: ${excerpt(annotation.body)}`}
                  aria-current={playingIds.has(annotation.id) ? 'time' : undefined}
                  style={{
                    ...noteColorStyle(annotation.color),
                    left: `${String(left)}%`,
                    top: `${String(top)}px`,
                    ...(width !== null && { width: `${String(width)}%` }),
                  }}
                  className={cn(
                    "group pointer-events-auto absolute -translate-y-1/2 border border-fg before:absolute before:-inset-x-1 before:-inset-y-2 before:content-[''] hover:z-10 focus-visible:z-10",
                    width === null
                      ? 'size-3 -translate-x-1/2 rounded-full bg-(--y2k-note-color)'
                      : 'h-2.5 min-w-2 rounded-xs bg-(--y2k-note-color)/70',
                    playingIds.has(annotation.id) && 'ring-2 ring-accent',
                    annotation.id === selectedId &&
                      'outline-2 outline-offset-2 outline-accent outline-dashed',
                  )}
                  onClick={() => {
                    onSelectNote(annotation);
                  }}
                  onFocus={() => {
                    setFocusIndex(index);
                  }}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'pointer-events-none absolute bottom-full mb-2.5 hidden w-max max-w-56 rounded-sm border border-fg bg-(--y2k-note-color) px-2 py-1 text-left text-xs text-(--sotd-note-ink) shadow-[2px_2px_0_var(--sotd-border)] group-hover:block group-focus-visible:block',
                      tooltipAlignment(left),
                    )}
                  >
                    <span className="block font-semibold tabular-nums">{time}</span>
                    <span className="line-clamp-3 break-words whitespace-pre-line">
                      {annotation.body}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div aria-hidden="true" className="relative h-4 text-xs leading-4 text-muted tabular-nums">
        {ticks.map((tick) => {
          const percent = msToPercent(tick, lengthMs);
          return (
            <span
              key={tick}
              className={cn('absolute top-0', tickLabelAlignment(percent))}
              style={{ left: `${String(percent)}%` }}
            >
              {formatMs(tick)}
            </span>
          );
        })}
      </div>
      {hint !== null && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
