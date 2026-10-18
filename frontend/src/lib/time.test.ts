import { describe, expect, it } from 'vitest';

import { formatMs, parseTimestamp } from './time';

describe('formatMs', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [1000, '0:01'],
    [83000, '1:23'],
    [599_999, '9:59'],
    [600_000, '10:00'],
    [3_599_000, '59:59'],
    [3_600_000, '1:00:00'],
    [3_723_000, '1:02:03'],
    [86_400_000, '24:00:00'],
    [-500, '0:00'],
  ])('formats %d ms as %s', (ms, text) => {
    expect(formatMs(ms)).toBe(text);
  });
});

describe('parseTimestamp', () => {
  it.each([
    ['83', 83_000],
    ['0', 0],
    ['1:23', 83_000],
    [' 1:23 ', 83_000],
    ['0:05', 5_000],
    ['1:5', 65_000],
    ['12:00', 720_000],
    ['90:00', 5_400_000],
    ['01:02:03', 3_723_000],
    ['1:00:00', 3_600_000],
  ])('parses %j as %d ms', (input, ms) => {
    expect(parseTimestamp(input)).toBe(ms);
  });

  it.each([
    '',
    '  ',
    'abc',
    '1:2:3:4',
    '1:60',
    '1:60:00',
    '1:00:60',
    '-1',
    '1.5',
    '1:',
    ':30',
    '1::2',
    '1:2a',
  ])('rejects %j', (input) => {
    expect(parseTimestamp(input)).toBeNull();
  });

  it('round-trips with formatMs', () => {
    for (const ms of [0, 59_000, 83_000, 3_723_000]) {
      expect(parseTimestamp(formatMs(ms))).toBe(ms);
    }
  });
});
