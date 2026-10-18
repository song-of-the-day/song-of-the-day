import { describe, expect, it } from 'vitest';

import { makeEntry, makeSongResult } from '@/test/fixtures';

import {
  detailsFromEntry,
  EMPTY_MANUAL_VALUES,
  manualValuesFromSong,
  validateDetails,
  validateManualSong,
  type DetailsValues,
} from './validation';

const TODAY = '2026-10-11';

describe('validateManualSong', () => {
  it('builds a trimmed manual song, parsing the length', () => {
    const result = validateManualSong({
      title: '  Gosh ',
      artist: ' Jamie xx',
      album: '',
      duration_ms: ' 4:51 ',
      external_url: ' https://jamiexx.bandcamp.com/track/gosh ',
    });

    expect(result.errors).toEqual({});
    expect(result.song).toEqual({
      source: 'manual',
      source_id: null,
      title: 'Gosh',
      artist: 'Jamie xx',
      album: null,
      artwork_url: null,
      preview_url: null,
      external_url: 'https://jamiexx.bandcamp.com/track/gosh',
      duration_ms: 291_000,
    });
  });

  it('leaves optional fields empty', () => {
    const { song } = validateManualSong({ ...EMPTY_MANUAL_VALUES, title: 'a', artist: 'b' });

    expect(song).toMatchObject({ album: null, duration_ms: null, external_url: null });
  });

  it('requires a title and an artist', () => {
    const result = validateManualSong({ ...EMPTY_MANUAL_VALUES, title: '   ' });

    expect(result.song).toBeNull();
    expect(result.errors).toEqual({
      title: 'Enter the song title.',
      artist: 'Enter the artist.',
    });
  });

  it('limits text to 300 code points', () => {
    const emoji = '🎵'.repeat(300);
    expect(
      validateManualSong({ ...EMPTY_MANUAL_VALUES, title: emoji, artist: 'x' }).errors,
    ).toEqual({});

    const result = validateManualSong({
      ...EMPTY_MANUAL_VALUES,
      title: 'x'.repeat(301),
      artist: 'x',
      album: 'x'.repeat(301),
    });
    expect(result.errors).toEqual({
      title: 'Use at most 300 characters.',
      album: 'Use at most 300 characters.',
    });
  });

  it.each([
    ['4:65', 'Enter the length as m:ss, e.g. 3:45.'],
    ['four minutes', 'Enter the length as m:ss, e.g. 3:45.'],
    ['0:00', 'Enter a length longer than 0:00.'],
    ['24:00:01', 'Enter a length under 24 hours.'],
  ])('rejects the length %s', (length, message) => {
    const { errors } = validateManualSong({
      ...EMPTY_MANUAL_VALUES,
      title: 'a',
      artist: 'b',
      duration_ms: length,
    });

    expect(errors).toEqual({ duration_ms: message });
  });

  it.each(['jamiexx.com', 'ftp://example.com/song', 'https://'])('rejects the link %s', (link) => {
    const { errors } = validateManualSong({
      ...EMPTY_MANUAL_VALUES,
      title: 'a',
      artist: 'b',
      external_url: link,
    });

    expect(errors).toEqual({ external_url: 'Enter a full link, starting with https://.' });
  });

  it('limits links to 1000 characters', () => {
    const { errors } = validateManualSong({
      ...EMPTY_MANUAL_VALUES,
      title: 'a',
      artist: 'b',
      external_url: `https://example.com/${'x'.repeat(1000)}`,
    });

    expect(errors).toEqual({ external_url: 'Use at most 1000 characters.' });
  });
});

describe('validateDetails', () => {
  const valid: DetailsValues = { entry_date: TODAY, note: '', youtube_video_id: '' };

  it('normalizes an empty note and link to null', () => {
    expect(validateDetails({ ...valid, note: '  \n ' }, TODAY)).toEqual({
      errors: {},
      details: { entry_date: TODAY, note: null, youtube_video_id: null },
    });
  });

  it('trims the note and reads the video id from a link', () => {
    const { details } = validateDetails(
      { ...valid, note: ' so good\n', youtube_video_id: 'https://youtu.be/dQw4w9WgXcQ?t=42' },
      TODAY,
    );

    expect(details).toEqual({
      entry_date: TODAY,
      note: 'so good',
      youtube_video_id: 'dQw4w9WgXcQ',
    });
  });

  it.each([
    ['', 'Choose a date.'],
    ['2026-02-30', 'Enter a valid date.'],
    ['1899-12-31', 'Choose a date in 1900 or later.'],
    ['2026-10-12', 'Choose today or an earlier day.'],
  ])('rejects the date "%s"', (date, message) => {
    const result = validateDetails({ ...valid, entry_date: date }, TODAY);

    expect(result).toEqual({ errors: { entry_date: message }, details: null });
  });

  it('accepts the first loggable day', () => {
    expect(validateDetails({ ...valid, entry_date: '1900-01-01' }, TODAY).errors).toEqual({});
  });

  it('rejects a link that is not a YouTube video', () => {
    const { errors } = validateDetails(
      { ...valid, youtube_video_id: 'https://vimeo.com/123' },
      TODAY,
    );

    expect(errors).toEqual({
      youtube_video_id: 'Paste a YouTube link, e.g. https://youtu.be/dQw4w9WgXcQ.',
    });
  });

  it('limits the note to 5000 characters', () => {
    const { errors } = validateDetails({ ...valid, note: 'x'.repeat(5001) }, TODAY);

    expect(errors).toEqual({ note: 'Use at most 5000 characters.' });
  });
});

describe('form prefills', () => {
  it('fills the manual form from a song', () => {
    expect(manualValuesFromSong(makeSongResult())).toEqual({
      title: 'Gosh',
      artist: 'Jamie xx',
      album: 'In Colour',
      duration_ms: '4:50',
      external_url: 'https://music.apple.com/us/album/gosh/1525506447?i=1525506452',
    });
    expect(
      manualValuesFromSong(makeSongResult({ album: null, duration_ms: null, external_url: null })),
    ).toMatchObject({ album: '', duration_ms: '', external_url: '' });
  });

  it('fills the details form from an entry, showing the video as a link', () => {
    expect(detailsFromEntry(makeEntry({ note: 'hi', youtube_video_id: 'dQw4w9WgXcQ' }))).toEqual({
      entry_date: '2026-10-11',
      note: 'hi',
      youtube_video_id: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
    expect(detailsFromEntry(makeEntry({ note: null, youtube_video_id: null }))).toMatchObject({
      note: '',
      youtube_video_id: '',
    });
  });
});
