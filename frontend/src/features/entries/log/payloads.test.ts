import { describe, expect, it } from 'vitest';

import { makeEntry, makeSongResult } from '@/test/fixtures';

import { buildCreateInput, buildEditPatch, buildReplacePatch } from './payloads';
import { songFromEntry, type SongDraft } from './songDraft';
import type { EntryDetails } from './validation';

const DETAILS: EntryDetails = {
  entry_date: '2026-10-11',
  note: 'so good',
  youtube_video_id: null,
};

const MANUAL_SONG: SongDraft = {
  source: 'manual',
  source_id: null,
  title: 'Untitled',
  artist: 'Me',
  album: null,
  artwork_url: null,
  preview_url: null,
  external_url: null,
  duration_ms: 120_000,
};

describe('buildCreateInput', () => {
  it('combines the song and the details', () => {
    const song = makeSongResult();

    expect(buildCreateInput(song, DETAILS)).toEqual({
      entry_date: '2026-10-11',
      ...song,
      note: 'so good',
      youtube_video_id: null,
    });
  });
});

describe('buildEditPatch', () => {
  const entry = makeEntry({ note: 'so good', youtube_video_id: null });

  it('is empty when nothing changed', () => {
    expect(buildEditPatch(entry, songFromEntry(entry), DETAILS)).toEqual({});
  });

  it('sends only the changed details', () => {
    const patch = buildEditPatch(entry, songFromEntry(entry), {
      entry_date: '2026-10-10',
      note: null,
      youtube_video_id: 'dQw4w9WgXcQ',
    });

    expect(patch).toEqual({
      entry_date: '2026-10-10',
      note: null,
      youtube_video_id: 'dQw4w9WgXcQ',
    });
  });

  it('sends only the song fields that differ', () => {
    const patch = buildEditPatch(
      entry,
      { ...songFromEntry(entry), title: 'Loud Places', source_id: '1525506460' },
      DETAILS,
    );

    expect(patch).toEqual({ title: 'Loud Places', source_id: '1525506460' });
  });

  it('clears the iTunes fields when switching to a manual song', () => {
    expect(buildEditPatch(entry, MANUAL_SONG, DETAILS)).toEqual({
      title: 'Untitled',
      artist: 'Me',
      album: null,
      artwork_url: null,
      preview_url: null,
      external_url: null,
      duration_ms: 120_000,
      source: 'manual',
      source_id: null,
    });
  });
});

describe('buildReplacePatch', () => {
  const song = makeSongResult({ title: 'Loud Places', source_id: '1525506460' });

  it('sends the song, plus the note only when filled in', () => {
    expect(buildReplacePatch(song, DETAILS, undefined)).toEqual({ ...song, note: 'so good' });
    expect(buildReplacePatch(song, { ...DETAILS, note: null }, undefined)).toEqual({ ...song });
  });

  it('sends a new video', () => {
    const details = { ...DETAILS, youtube_video_id: 'dQw4w9WgXcQ' };

    expect(buildReplacePatch(song, details, undefined)).toMatchObject({
      youtube_video_id: 'dQw4w9WgXcQ',
    });
  });

  it("clears a video that belongs to the replaced entry's other song", () => {
    const existing = makeEntry({ youtube_video_id: 'aaaaaaaaaaa' });

    expect(buildReplacePatch(song, DETAILS, existing)).toMatchObject({ youtube_video_id: null });
  });

  it('keeps the video when the song is the same, or there is none', () => {
    const existing = makeEntry({ youtube_video_id: 'aaaaaaaaaaa' });
    const same = buildReplacePatch(songFromEntry(existing), DETAILS, existing);
    const noVideo = buildReplacePatch(song, DETAILS, makeEntry({ youtube_video_id: null }));

    expect(same).not.toHaveProperty('youtube_video_id');
    expect(noVideo).not.toHaveProperty('youtube_video_id');
  });
});
