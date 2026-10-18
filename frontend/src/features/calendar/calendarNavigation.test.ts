import { describe, expect, it } from 'vitest';

import { initialFocusDate, nextFocusDate } from './calendarNavigation';

const OCTOBER_TO_11TH = Array.from(
  { length: 11 },
  (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`,
);

describe('initialFocusDate', () => {
  it('prefers today', () => {
    expect(initialFocusDate(OCTOBER_TO_11TH, '2026-10-11')).toBe('2026-10-11');
  });

  it('falls back to the first focusable day in other months', () => {
    expect(initialFocusDate(['2026-09-01', '2026-09-02'], '2026-10-11')).toBe('2026-09-01');
  });

  it('is null when nothing is focusable', () => {
    expect(initialFocusDate([], '2026-10-11')).toBeNull();
  });
});

describe('nextFocusDate', () => {
  it.each([
    ['ArrowLeft', '2026-10-07'],
    ['ArrowRight', '2026-10-09'],
    ['ArrowUp', '2026-10-01'],
    ['Home', '2026-10-01'],
    ['End', '2026-10-11'],
  ])('moves with %s', (key, target) => {
    expect(nextFocusDate(key, '2026-10-08', OCTOBER_TO_11TH)).toBe(target);
  });

  it('moves down a week', () => {
    expect(nextFocusDate('ArrowDown', '2026-10-02', OCTOBER_TO_11TH)).toBe('2026-10-09');
  });

  it('ignores moves onto days that are not focusable', () => {
    expect(nextFocusDate('ArrowRight', '2026-10-11', OCTOBER_TO_11TH)).toBeNull();
    expect(nextFocusDate('ArrowDown', '2026-10-05', OCTOBER_TO_11TH)).toBeNull();
    expect(nextFocusDate('ArrowLeft', '2026-10-01', OCTOBER_TO_11TH)).toBeNull();
  });

  it('ignores other keys and empty months', () => {
    expect(nextFocusDate('Enter', '2026-10-05', OCTOBER_TO_11TH)).toBeNull();
    expect(nextFocusDate('Home', '2026-10-05', [])).toBeNull();
    expect(nextFocusDate('End', '2026-10-05', [])).toBeNull();
  });
});
