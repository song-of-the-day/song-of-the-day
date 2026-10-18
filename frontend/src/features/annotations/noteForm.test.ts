import { describe, expect, it } from 'vitest';

import { makeAnnotation } from '@/test/fixtures';

import { noteColorStyle } from './noteColors';
import {
  BODY_MAX_LENGTH,
  BODY_REQUIRED_MESSAGE,
  BODY_TOO_LONG_MESSAGE,
  END_BEFORE_START_MESSAGE,
  noteCreateInput,
  noteFormValues,
  noteUpdatePatch,
  START_REQUIRED_MESSAGE,
  TIME_FORMAT_MESSAGE,
  TIME_TOO_LATE_MESSAGE,
  validateNoteForm,
  type NoteFormValues,
} from './noteForm';

function values(overrides: Partial<NoteFormValues> = {}): NoteFormValues {
  return { start: '1:23', end: '', body: 'the drop', color: 'pink', ...overrides };
}

describe('noteFormValues', () => {
  it('starts empty and yellow', () => {
    expect(noteFormValues()).toEqual({ start: '', end: '', body: '', color: 'yellow' });
  });

  it('shows prefilled and saved times as m:ss', () => {
    expect(noteFormValues({ start_ms: 83_000, end_ms: 105_900 })).toMatchObject({
      start: '1:23',
      end: '1:45',
    });
    expect(
      noteFormValues(makeAnnotation({ start_ms: 0, end_ms: null, body: 'hi', color: 'blue' })),
    ).toEqual({ start: '0:00', end: '', body: 'hi', color: 'blue' });
  });
});

describe('validateNoteForm', () => {
  it('accepts a point note, trimming the text', () => {
    expect(validateNoteForm(values({ body: '  the drop \n' }))).toEqual({
      errors: {},
      draft: { start_ms: 83_000, end_ms: null, body: 'the drop', color: 'pink' },
    });
  });

  it('accepts a range and plain seconds or h:mm:ss', () => {
    expect(validateNoteForm(values({ start: '83', end: '1:01:00' })).draft).toMatchObject({
      start_ms: 83_000,
      end_ms: 3_660_000,
    });
  });

  it('requires a start in m:ss within 24 hours', () => {
    expect(validateNoteForm(values({ start: ' ' })).errors).toEqual({
      start_ms: START_REQUIRED_MESSAGE,
    });
    expect(validateNoteForm(values({ start: '1:75' })).errors).toEqual({
      start_ms: TIME_FORMAT_MESSAGE,
    });
    expect(validateNoteForm(values({ start: '24:00:01' })).errors).toEqual({
      start_ms: TIME_TOO_LATE_MESSAGE,
    });
  });

  it('checks the end format and that it comes after the start', () => {
    expect(validateNoteForm(values({ end: 'soon' })).errors).toEqual({
      end_ms: TIME_FORMAT_MESSAGE,
    });
    expect(validateNoteForm(values({ end: '1:23' })).errors).toEqual({
      end_ms: END_BEFORE_START_MESSAGE,
    });
    expect(validateNoteForm(values({ end: '1:00' })).draft).toBeNull();
  });

  it('does not compare the end with an invalid start', () => {
    expect(validateNoteForm(values({ start: 'x', end: '0:10' })).errors).toEqual({
      start_ms: TIME_FORMAT_MESSAGE,
    });
  });

  it('requires 1 to 1000 characters of text, counted by code point', () => {
    expect(validateNoteForm(values({ body: ' \n ' })).errors).toEqual({
      body: BODY_REQUIRED_MESSAGE,
    });
    expect(validateNoteForm(values({ body: '🎸'.repeat(BODY_MAX_LENGTH) })).draft).not.toBeNull();
    expect(validateNoteForm(values({ body: 'a'.repeat(BODY_MAX_LENGTH + 1) })).errors).toEqual({
      body: BODY_TOO_LONG_MESSAGE,
    });
  });

  it('reports every invalid field at once', () => {
    expect(Object.keys(validateNoteForm(values({ start: '', end: 'x', body: '' })).errors)).toEqual(
      ['start_ms', 'end_ms', 'body'],
    );
  });
});

describe('noteCreateInput', () => {
  it('sends end_ms only for a range', () => {
    const draft = { start_ms: 1000, end_ms: null, body: 'a', color: 'green' as const };
    expect(noteCreateInput(draft)).toEqual({ start_ms: 1000, body: 'a', color: 'green' });
    expect(noteCreateInput({ ...draft, end_ms: 5000 })).toEqual({
      start_ms: 1000,
      end_ms: 5000,
      body: 'a',
      color: 'green',
    });
  });
});

describe('noteUpdatePatch', () => {
  const saved = makeAnnotation({ start_ms: 83_400, end_ms: 105_000, body: 'a', color: 'yellow' });

  it('is empty when nothing changed, keeping sub-second times', () => {
    expect(
      noteUpdatePatch(saved, { start_ms: 83_000, end_ms: 105_000, body: 'a', color: 'yellow' }),
    ).toEqual({});
  });

  it('sends only the changed fields', () => {
    expect(
      noteUpdatePatch(saved, { start_ms: 90_000, end_ms: 105_000, body: 'b', color: 'purple' }),
    ).toEqual({ start_ms: 90_000, body: 'b', color: 'purple' });
  });

  it('turns a cleared end into end_ms: null, and adds one to a point', () => {
    expect(
      noteUpdatePatch(saved, { start_ms: 83_000, end_ms: null, body: 'a', color: 'yellow' }),
    ).toEqual({ end_ms: null });
    const pointNote = makeAnnotation({ start_ms: 0, end_ms: null, body: 'a', color: 'yellow' });
    expect(
      noteUpdatePatch(pointNote, { start_ms: 0, end_ms: 4000, body: 'a', color: 'yellow' }),
    ).toEqual({ end_ms: 4000 });
  });
});

describe('noteColors', () => {
  it('sets the color variable to the hex value', () => {
    expect(noteColorStyle('pink')).toEqual({ '--y2k-note-color': '#FFC8E1' });
  });

  it('rejects an unknown color', () => {
    // @ts-expect-error -- guards against bad API data at runtime.
    expect(() => noteColorStyle('orange')).toThrow('Unknown note color "orange"');
  });
});
