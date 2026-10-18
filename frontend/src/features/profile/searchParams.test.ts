import { describe, expect, it } from 'vitest';

import { parseEntryParam, parseMonthParam, parseViewParam } from './searchParams';

describe('parseEntryParam', () => {
  it('reads a positive integer id', () => {
    expect(parseEntryParam('42')).toBe(42);
  });

  it.each([null, '', '0', '-3', '4.5', '07', 'abc', '1e3', '99999999999999999999'])(
    'rejects %s',
    (value) => {
      expect(parseEntryParam(value)).toBeNull();
    },
  );
});

describe('parseViewParam', () => {
  it.each(['board', 'calendar'] as const)('reads %s', (view) => {
    expect(parseViewParam(view)).toBe(view);
  });

  it.each([null, '', 'Board', 'grid'])('rejects %s', (value) => {
    expect(parseViewParam(value)).toBeNull();
  });
});

describe('parseMonthParam', () => {
  it.each(['2026-10', '1900-01', '9999-12'])('reads %s', (month) => {
    expect(parseMonthParam(month)).toBe(month);
  });

  it.each([null, '', '2026-13', '2026-00', '2026-1', '1899-12', '2026-10-01', 'oct'])(
    'rejects %s',
    (value) => {
      expect(parseMonthParam(value)).toBeNull();
    },
  );
});
