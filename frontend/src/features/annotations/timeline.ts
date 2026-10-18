/**
 * Pure math for the annotation timeline: its length, conversions between
 * song positions, percentages and pointer coordinates, tick marks, lanes for overlapping notes,
 * and which notes are playing.
 */
import type { Annotation } from '@/api/types';
import { formatMs } from '@/lib/time';

/** The timeline length when neither the player nor the entry knows the song's length (3:00). */
export const DEFAULT_LENGTH_MS = 180_000;
/** Room kept after the last note's end. */
export const TAIL_MS = 5_000;
/** How long after its time a point note counts as playing. */
export const POINT_SPAN_MS = 3_000;
/** Drags shorter than this are ignored rather than turned into a range. */
export const MIN_RANGE_MS = 1_000;
/** Overlapping notes are spread over at most this many rows. */
export const MAX_LANES = 3;

const DEFAULT_MAX_TICKS = 6;
const TICK_STEPS_MS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10_800, 21_600].map(
  (seconds) => seconds * 1000,
);
/** Visual padding around each note, as a share of the length, when packing lanes. */
const LANE_PADDING_RATIO = 0.015;

/** The timing fields of a note. */
export type TimedNote = Pick<Annotation, 'start_ms' | 'end_ms'>;
/** A note with its id, for results keyed by note. */
export type IdentifiedNote = TimedNote & Pick<Annotation, 'id'>;

export interface TimelineScale {
  lengthMs: number;
  /** The length comes from the player or the entry, so drag positions map to real times. */
  real: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Works out the timeline length: `max(base, max over notes of (end ?? start) + TAIL_MS)`, where
 * `base` is the player's duration when known (> 0), else the entry's `duration_ms`, else 3:00.
 *
 * @param playerDurationMs - The player's duration (0 when unknown or there is no player).
 * @param entryDurationMs - The entry's `duration_ms`.
 * @param notes - The entry's notes.
 * @returns The length and whether it is real (not the 3:00 fallback).
 */
export function timelineScale(
  playerDurationMs: number,
  entryDurationMs: number | null,
  notes: readonly TimedNote[],
): TimelineScale {
  let base = DEFAULT_LENGTH_MS;
  let real = false;
  if (playerDurationMs > 0) {
    base = playerDurationMs;
    real = true;
  } else if (entryDurationMs !== null && entryDurationMs > 0) {
    base = entryDurationMs;
    real = true;
  }
  const lengthMs = notes.reduce(
    (length, note) => Math.max(length, (note.end_ms ?? note.start_ms) + TAIL_MS),
    base,
  );
  return { lengthMs, real };
}

/**
 * Converts a song position to a horizontal position on the timeline.
 *
 * @param ms - The position.
 * @param lengthMs - The timeline length.
 * @returns A percentage from 0 to 100 (0 for an empty timeline).
 */
export function msToPercent(ms: number, lengthMs: number): number {
  return lengthMs > 0 ? clamp((ms / lengthMs) * 100, 0, 100) : 0;
}

/**
 * Converts a horizontal position on the timeline to a song position.
 *
 * @param percent - A percentage of the width.
 * @param lengthMs - The timeline length.
 * @returns The position, clamped to the timeline.
 */
export function percentToMs(percent: number, lengthMs: number): number {
  return clamp((percent / 100) * lengthMs, 0, Math.max(0, lengthMs));
}

/** The horizontal extent of the timeline track on screen. */
export interface TrackRect {
  left: number;
  width: number;
}

/**
 * Converts a pointer position over the track to a song position, snapped to whole steps.
 *
 * @param clientX - The pointer's x coordinate.
 * @param rect - The track's left edge and width.
 * @param lengthMs - The timeline length.
 * @param stepMs - The snapping step (default one second, the precision of `m:ss`).
 * @returns The position, clamped to the timeline (0 for a track without width).
 */
export function pointerToMs(
  clientX: number,
  rect: TrackRect,
  lengthMs: number,
  stepMs = 1000,
): number {
  if (rect.width <= 0 || lengthMs <= 0) {
    return 0;
  }
  const ms = percentToMs(((clientX - rect.left) / rect.width) * 100, lengthMs);
  return clamp(Math.round(ms / stepMs) * stepMs, 0, lengthMs);
}

/**
 * Picks tick marks at a "nice" interval (5 s, 10 s, 15 s, 30 s, 1 min, 2 min, 5 min, …), the
 * smallest that keeps at most `maxTicks` ticks.
 *
 * @param lengthMs - The timeline length.
 * @param maxTicks - The most ticks to return (at least 2).
 * @returns Tick positions from 0, in order, all within the length.
 */
export function generateTicks(lengthMs: number, maxTicks = DEFAULT_MAX_TICKS): number[] {
  if (lengthMs <= 0) {
    return [0];
  }
  const limit = Math.max(2, maxTicks);
  const step =
    TICK_STEPS_MS.find((candidate) => Math.floor(lengthMs / candidate) + 1 <= limit) ??
    Math.ceil(lengthMs / (limit - 1));
  const ticks: number[] = [];
  for (let tick = 0; tick <= lengthMs; tick += step) {
    ticks.push(tick);
  }
  return ticks;
}

/** Rows for overlapping notes. */
export interface LaneLayout {
  /** The row of each note, by id. */
  lanes: Map<number, number>;
  /** How many rows are used (at least 1). */
  count: number;
}

/**
 * Spreads notes over rows so overlapping ones don't cover each other. Each note takes its span
 * plus a little padding (so neighboring pins stay apart); once `maxLanes` rows are in use, a note
 * goes to the row that frees up first.
 *
 * @param notes - The notes, in any order.
 * @param lengthMs - The timeline length (sets the padding).
 * @param maxLanes - The most rows to use.
 * @returns Each note's row and the row count.
 */
export function assignLanes(
  notes: readonly IdentifiedNote[],
  lengthMs: number,
  maxLanes = MAX_LANES,
): LaneLayout {
  const padding = lengthMs * LANE_PADDING_RATIO;
  const laneEnds: number[] = [];
  const lanes = new Map<number, number>();
  const ordered = notes.toSorted((a, b) => a.start_ms - b.start_ms || a.id - b.id);
  for (const note of ordered) {
    const start = note.start_ms - padding;
    const end = (note.end_ms ?? note.start_ms) + padding;
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1 && laneEnds.length < maxLanes) {
      lane = laneEnds.length;
    } else if (lane === -1) {
      lane = laneEnds.indexOf(Math.min(...laneEnds));
    }
    laneEnds[lane] = Math.max(laneEnds[lane] ?? end, end);
    lanes.set(note.id, lane);
  }
  return { lanes, count: Math.max(1, laneEnds.length) };
}

/**
 * Checks whether a note is playing at a position: a range from its start until (not including)
 * its end, a point for {@link POINT_SPAN_MS} after its time.
 *
 * @param note - The note.
 * @param timeMs - The playback position.
 * @returns Whether the note contains the position.
 */
export function containsTime(note: TimedNote, timeMs: number): boolean {
  const end = note.end_ms ?? note.start_ms + POINT_SPAN_MS;
  return timeMs >= note.start_ms && timeMs < end;
}

/**
 * Finds the notes playing at a position.
 *
 * @param notes - The notes.
 * @param timeMs - The playback position.
 * @returns The ids of the notes that contain it.
 */
export function notesAt(notes: readonly IdentifiedNote[], timeMs: number): Set<number> {
  return new Set(notes.filter((note) => containsTime(note, timeMs)).map((note) => note.id));
}

/**
 * Formats a note's time: `"1:23"` for a point, `"1:23–1:45"` for a range.
 *
 * @param note - The note.
 * @returns The label.
 */
export function formatNoteTime(note: TimedNote): string {
  const start = formatMs(note.start_ms);
  return note.end_ms === null ? start : `${start}–${formatMs(note.end_ms)}`;
}
