import { describe, expect, it } from 'vitest';

import { deleteEntryMessage } from './messages';

describe('deleteEntryMessage', () => {
  it('mentions the notes that go with the song', () => {
    expect(deleteEntryMessage(0)).toBe("Delete this day's song?");
    expect(deleteEntryMessage(1)).toBe("Delete this day's song and its 1 note?");
    expect(deleteEntryMessage(12)).toBe("Delete this day's song and its 12 notes?");
  });
});
