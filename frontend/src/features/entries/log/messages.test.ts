import { describe, expect, it } from 'vitest';

import { alreadyLoggedMessage, describeDay, notesStayAttachedMessage } from './messages';

describe('describeDay', () => {
  it('names days of this year briefly', () => {
    expect(describeDay('2026-10-11', '2026-10-11')).toBe('Sun, Oct 11');
  });

  it('spells out days of other years', () => {
    expect(describeDay('2025-03-03', '2026-10-11')).toBe('Monday, March 3, 2025');
  });
});

describe('notesStayAttachedMessage', () => {
  it.each([
    [1, 'Your 1 note stays attached; its timestamp was for the previous song.'],
    [3, 'Your 3 notes stay attached; their timestamps were for the previous song.'],
  ])('warns about %i note(s)', (count, message) => {
    expect(notesStayAttachedMessage(count)).toBe(message);
  });
});

describe('alreadyLoggedMessage', () => {
  it('names the logged song once known', () => {
    expect(alreadyLoggedMessage('Gosh', 'Sun, Oct 11')).toBe(
      'You already logged Gosh for Sun, Oct 11.',
    );
    expect(alreadyLoggedMessage(undefined, 'Sun, Oct 11')).toBe(
      'You already logged a song for Sun, Oct 11.',
    );
  });
});
