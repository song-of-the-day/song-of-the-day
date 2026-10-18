import { describe, expect, it } from 'vitest';

import {
  assignLanes,
  containsTime,
  DEFAULT_LENGTH_MS,
  formatNoteTime,
  generateTicks,
  msToPercent,
  notesAt,
  percentToMs,
  pointerToMs,
  POINT_SPAN_MS,
  TAIL_MS,
  timelineScale,
} from './timeline';

const point = (id: number, start: number) => ({ id, start_ms: start, end_ms: null });
const range = (id: number, start: number, end: number) => ({ id, start_ms: start, end_ms: end });

describe('timelineScale', () => {
  it('prefers the player duration once it is known', () => {
    expect(timelineScale(212_000, 290_000, [])).toEqual({ lengthMs: 212_000, real: true });
  });

  it("falls back to the entry's duration while the player reports 0", () => {
    expect(timelineScale(0, 290_000, [])).toEqual({ lengthMs: 290_000, real: true });
  });

  it('uses an approximate 3:00 without any known length', () => {
    expect(timelineScale(0, null, [])).toEqual({ lengthMs: DEFAULT_LENGTH_MS, real: false });
    expect(timelineScale(0, 0, [])).toEqual({ lengthMs: DEFAULT_LENGTH_MS, real: false });
  });

  it('grows past the last note end (or point) by five seconds', () => {
    expect(timelineScale(0, null, [range(1, 10_000, 200_000)]).lengthMs).toBe(200_000 + TAIL_MS);
    expect(timelineScale(100_000, null, [point(1, 150_000)])).toEqual({
      lengthMs: 150_000 + TAIL_MS,
      real: true,
    });
  });

  it('keeps the base when every note fits', () => {
    expect(timelineScale(0, 240_000, [range(1, 1_000, 30_000), point(2, 60_000)]).lengthMs).toBe(
      240_000,
    );
  });
});

describe('msToPercent and percentToMs', () => {
  it('converts both ways', () => {
    expect(msToPercent(45_000, 180_000)).toBe(25);
    expect(percentToMs(25, 180_000)).toBe(45_000);
  });

  it('clamps to the timeline', () => {
    expect(msToPercent(-5, 1000)).toBe(0);
    expect(msToPercent(5000, 1000)).toBe(100);
    expect(percentToMs(-10, 1000)).toBe(0);
    expect(percentToMs(150, 1000)).toBe(1000);
  });

  it('handles an empty timeline', () => {
    expect(msToPercent(10, 0)).toBe(0);
    expect(percentToMs(50, 0)).toBe(0);
  });
});

describe('pointerToMs', () => {
  const rect = { left: 100, width: 400 };

  it('maps the pointer over the track to whole seconds', () => {
    expect(pointerToMs(300, rect, 180_000)).toBe(90_000);
    expect(pointerToMs(101, rect, 180_000)).toBe(0);
    expect(pointerToMs(102.3, rect, 180_000)).toBe(1_000);
  });

  it('snaps to a custom step', () => {
    expect(pointerToMs(300, rect, 180_100, 5_000)).toBe(90_000);
  });

  it('clamps outside the track', () => {
    expect(pointerToMs(0, rect, 180_000)).toBe(0);
    expect(pointerToMs(900, rect, 180_000)).toBe(180_000);
    // Rounding up at the end never goes past the length.
    expect(pointerToMs(500, rect, 180_600)).toBe(180_600);
  });

  it('returns 0 without a width or length', () => {
    expect(pointerToMs(300, { left: 0, width: 0 }, 180_000)).toBe(0);
    expect(pointerToMs(300, rect, 0)).toBe(0);
  });
});

describe('generateTicks', () => {
  it('picks the smallest nice interval that fits', () => {
    expect(generateTicks(180_000)).toEqual([0, 60_000, 120_000, 180_000]);
    expect(generateTicks(290_973)).toEqual([0, 60_000, 120_000, 180_000, 240_000]);
    expect(generateTicks(20_000)).toEqual([0, 5_000, 10_000, 15_000, 20_000]);
    expect(generateTicks(600_000)).toEqual([0, 120_000, 240_000, 360_000, 480_000, 600_000]);
  });

  it('respects the tick limit (at least two)', () => {
    expect(generateTicks(180_000, 3)).toEqual([0, 120_000]);
    expect(generateTicks(180_000, 1)).toEqual(generateTicks(180_000, 2));
  });

  it('falls back to an even split beyond the largest interval', () => {
    expect(generateTicks(86_400_000, 2)).toEqual([0, 86_400_000]);
  });

  it('returns a single tick for an empty timeline', () => {
    expect(generateTicks(0)).toEqual([0]);
  });
});

describe('assignLanes', () => {
  it('keeps separate notes in one row', () => {
    const layout = assignLanes([point(1, 10_000), range(2, 60_000, 90_000)], 180_000);
    expect(layout.count).toBe(1);
    expect([...layout.lanes]).toEqual([
      [1, 0],
      [2, 0],
    ]);
  });

  it('moves overlapping notes to new rows, in start order', () => {
    const layout = assignLanes(
      [range(3, 30_000, 40_000), range(1, 10_000, 60_000), point(2, 28_000)],
      180_000,
    );
    expect(layout.lanes.get(1)).toBe(0);
    expect(layout.lanes.get(2)).toBe(1);
    expect(layout.lanes.get(3)).toBe(2);
    expect(layout.count).toBe(3);
  });

  it('reuses a row once its note is over', () => {
    const layout = assignLanes(
      [range(1, 0, 100_000), range(2, 10_000, 20_000), range(3, 50_000, 60_000)],
      180_000,
    );
    expect(layout.lanes.get(3)).toBe(1);
    expect(layout.count).toBe(2);
  });

  it('keeps pins close together apart', () => {
    const layout = assignLanes([point(1, 60_000), point(2, 61_000)], 180_000);
    expect(layout.lanes.get(2)).toBe(1);
  });

  it('puts notes past the row limit in the row that frees up first', () => {
    const layout = assignLanes(
      [range(1, 0, 100_000), range(2, 0, 50_000), range(3, 0, 80_000), point(4, 10_000)],
      180_000,
      3,
    );
    expect(layout.count).toBe(3);
    expect(layout.lanes.get(4)).toBe(1);
  });

  it('breaks start ties by id and uses one row without notes', () => {
    const layout = assignLanes([point(9, 0), point(4, 0)], 180_000);
    expect(layout.lanes.get(4)).toBe(0);
    expect(layout.lanes.get(9)).toBe(1);
    expect(assignLanes([], 180_000).count).toBe(1);
  });
});

describe('containsTime and notesAt', () => {
  it('treats a range as start inclusive, end exclusive', () => {
    const note = range(1, 10_000, 20_000);
    expect(containsTime(note, 9_999)).toBe(false);
    expect(containsTime(note, 10_000)).toBe(true);
    expect(containsTime(note, 19_999)).toBe(true);
    expect(containsTime(note, 20_000)).toBe(false);
  });

  it('keeps a point playing briefly after its time', () => {
    const note = point(1, 10_000);
    expect(containsTime(note, 10_000)).toBe(true);
    expect(containsTime(note, 10_000 + POINT_SPAN_MS - 1)).toBe(true);
    expect(containsTime(note, 10_000 + POINT_SPAN_MS)).toBe(false);
  });

  it('finds every note playing at a time', () => {
    const notes = [range(1, 0, 30_000), point(2, 12_000), range(3, 40_000, 50_000)];
    expect(notesAt(notes, 13_000)).toEqual(new Set([1, 2]));
    expect(notesAt(notes, 35_000)).toEqual(new Set());
  });
});

describe('formatNoteTime', () => {
  it('labels points and ranges', () => {
    expect(formatNoteTime({ start_ms: 83_000, end_ms: null })).toBe('1:23');
    expect(formatNoteTime({ start_ms: 83_000, end_ms: 105_500 })).toBe('1:23–1:45');
  });
});
