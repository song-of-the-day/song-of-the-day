import { describe, expect, it } from 'vitest';

import { notesLabel, openEntryLabel, spokenDate } from './entryLabel';

describe('spokenDate', () => {
  it('spells out a date', () => {
    expect(spokenDate('2026-10-11')).toBe('Sunday, October 11, 2026');
  });

  it('keeps a malformed date as given', () => {
    expect(spokenDate('2026-02-30')).toBe('2026-02-30');
  });
});

describe('openEntryLabel', () => {
  it('names the song, artist and day', () => {
    expect(openEntryLabel({ title: 'Gosh', artist: 'Jamie xx', entry_date: '2026-10-11' })).toBe(
      'Open Gosh by Jamie xx, Sunday, October 11, 2026',
    );
  });
});

describe('notesLabel', () => {
  it.each([
    [1, '1 note'],
    [3, '3 notes'],
  ])('counts %i', (count, label) => {
    expect(notesLabel(count)).toBe(label);
  });
});
