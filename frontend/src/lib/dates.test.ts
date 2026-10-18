import { afterEach, describe, expect, it, vi } from 'vitest';

import { FIXED_NOW } from '@/test/fixtures';

import {
  addDaysIso,
  addMonthsKey,
  daysInRange,
  formatDisplayDate,
  formatFullDate,
  formatMonthTitle,
  isAfterToday,
  isIsoDate,
  localToday,
  monthGrid,
  monthKeyOf,
  monthRange,
  msUntilNextLocalMidnight,
  parseIsoDate,
  parseMonthKey,
  toIsoDate,
} from './dates';

afterEach(() => {
  vi.useRealTimers();
});

describe('toIsoDate / localToday', () => {
  it('formats the local calendar date', () => {
    expect(toIsoDate(new Date(2026, 9, 11, 23, 59))).toBe('2026-10-11');
    expect(toIsoDate(new Date(2026, 0, 2))).toBe('2026-01-02');
  });

  it('reads today from the clock', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);

    expect(localToday()).toBe('2026-10-11');
    expect(localToday(new Date(2027, 1, 3))).toBe('2027-02-03');
  });
});

describe('parseIsoDate / isIsoDate', () => {
  it('parses to local midnight', () => {
    const date = parseIsoDate('2024-02-29');

    expect(date?.getFullYear()).toBe(2024);
    expect(date?.getMonth()).toBe(1);
    expect(date?.getDate()).toBe(29);
    expect(date?.getHours()).toBe(0);
  });

  it.each([
    '2026-02-30',
    '2025-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-1-1',
    '26-10-11',
    '',
    'today',
    '2026-10-11T00:00',
  ])('rejects %j', (value) => {
    expect(parseIsoDate(value)).toBeNull();
    expect(isIsoDate(value)).toBe(false);
  });

  it('accepts real dates', () => {
    expect(isIsoDate('1900-01-01')).toBe(true);
    expect(isIsoDate('2026-10-11')).toBe(true);
  });
});

describe('addDaysIso / daysInRange / isAfterToday', () => {
  it('shifts across month and year boundaries', () => {
    expect(addDaysIso('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysIso('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysIso('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('throws on invalid input', () => {
    expect(() => addDaysIso('2026-02-30', 1)).toThrow('Invalid ISO date: "2026-02-30"');
  });

  it('counts inclusive ranges', () => {
    expect(daysInRange('2026-10-11', '2026-10-11')).toBe(1);
    expect(daysInRange('2026-10-01', '2026-10-31')).toBe(31);
    expect(daysInRange('2024-01-01', '2024-12-31')).toBe(366);
    expect(daysInRange('2026-10-12', '2026-10-11')).toBe(0);
  });

  it('detects future dates', () => {
    expect(isAfterToday('2026-10-12', '2026-10-11')).toBe(true);
    expect(isAfterToday('2026-10-11', '2026-10-11')).toBe(false);
    expect(isAfterToday('2025-12-31', '2026-10-11')).toBe(false);
  });
});

describe('month keys', () => {
  it('derives the month key of a date', () => {
    expect(monthKeyOf('2026-10-11')).toBe('2026-10');
    expect(monthKeyOf(new Date(2026, 0, 31))).toBe('2026-01');
  });

  it('parses valid keys only', () => {
    expect(parseMonthKey('2026-10')?.getDate()).toBe(1);
    expect(parseMonthKey('2026-13')).toBeNull();
    expect(parseMonthKey('2026-1')).toBeNull();
    expect(parseMonthKey('2026-10-01')).toBeNull();
  });

  it('shifts months across years', () => {
    expect(addMonthsKey('2026-12', 1)).toBe('2027-01');
    expect(addMonthsKey('2026-01', -1)).toBe('2025-12');
    expect(() => addMonthsKey('nope', 1)).toThrow('Invalid month key: "nope"');
  });

  it('computes inclusive month ranges', () => {
    expect(monthRange('2026-10')).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(monthRange('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(monthRange('2026-11')).toEqual({ start: '2026-11-01', end: '2026-11-30' });
  });
});

describe('monthGrid', () => {
  it('starts weeks on Sunday with blanks outside the month', () => {
    const grid = monthGrid('2026-10');

    // October 1, 2026 is a Thursday.
    expect(grid[0]).toEqual([null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(grid[1]?.[0]).toBe('2026-10-04');
    expect(grid.at(-1)).toEqual([
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
    ]);
    expect(grid).toHaveLength(5);
    expect(grid.flat().filter((cell) => cell !== null)).toHaveLength(31);
  });

  it('pads the last week', () => {
    const grid = monthGrid('2026-11');

    expect(grid[0]?.[0]).toBe('2026-11-01');
    expect(grid.at(-1)).toEqual(['2026-11-29', '2026-11-30', null, null, null, null, null]);
  });

  it('handles 4- and 6-week months', () => {
    expect(monthGrid('2026-02')).toHaveLength(4);
    expect(monthGrid('2026-08')).toHaveLength(6);
    for (const week of monthGrid('2026-08')) {
      expect(week).toHaveLength(7);
    }
  });
});

describe('formatting', () => {
  it('formats display dates', () => {
    expect(formatDisplayDate('2026-10-11')).toBe('Sun, Oct 11');
    expect(formatFullDate('2026-10-11')).toBe('Sunday, October 11, 2026');
    expect(formatMonthTitle('2026-10')).toBe('October 2026');
  });

  it('throws on invalid input', () => {
    expect(() => formatDisplayDate('nope')).toThrow('Invalid ISO date');
    expect(() => formatMonthTitle('2026-00')).toThrow('Invalid month key');
  });
});

describe('msUntilNextLocalMidnight', () => {
  it('measures the time to the next local midnight', () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 9, 11, 23, 59, 30))).toBe(30_000);
    expect(msUntilNextLocalMidnight(new Date(2026, 9, 11, 0, 0, 0))).toBe(86_400_000);
  });

  it('defaults to the current time', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 11, 18, 0, 0));

    expect(msUntilNextLocalMidnight()).toBe(6 * 3_600_000);
  });
});
