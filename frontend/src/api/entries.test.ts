import { describe, expect, it } from 'vitest';

import { fakeApi } from '@/test/fakeApi';

import { createEntry, deleteEntry, updateEntry } from './entries';

function signedIn() {
  const user = fakeApi.seedUser();
  fakeApi.signIn(user.id);
  return user;
}

describe('createEntry', () => {
  it('creates a manual entry with defaults', async () => {
    signedIn();

    const entry = await createEntry({
      entry_date: '2026-10-11',
      title: ' Teardrop ',
      artist: 'Massive Attack',
      note: '  ',
    });

    expect(entry).toMatchObject({
      title: 'Teardrop',
      source: 'manual',
      album: null,
      note: null,
      annotation_count: 0,
      annotations: [],
    });
  });

  it('reports entry_exists with the existing id', async () => {
    const user = signedIn();
    const existing = fakeApi.seedEntry(user.id, { entry_date: '2026-10-11' });

    await expect(
      createEntry({ entry_date: '2026-10-11', title: 'Again', artist: 'Someone' }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'entry_exists',
      details: { existing_entry_id: existing.id },
    });
  });

  it('validates song fields', async () => {
    signedIn();

    await expect(
      createEntry({
        entry_date: '2026-10-11',
        title: 'Song',
        artist: 'Artist',
        artwork_url: 'https://example.com/art.jpg',
        youtube_video_id: 'nope',
        duration_ms: 0,
      }),
    ).rejects.toMatchObject({
      code: 'validation_error',
      fields: {
        artwork_url: 'Enter a valid URL.',
        youtube_video_id: 'Enter a valid YouTube video id.',
        duration_ms: 'Must be between 1 and 86400000.',
      },
    });
  });
});

describe('updateEntry / deleteEntry', () => {
  it("returns not_found for another user's entry", async () => {
    signedIn();
    const other = fakeApi.seedUser();
    const entry = fakeApi.seedEntry(other.id);

    await expect(updateEntry(entry.id, { note: 'mine now' })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
    await expect(deleteEntry(entry.id)).rejects.toMatchObject({ status: 404 });
  });

  it('patches only the given fields and clears nullable ones with null', async () => {
    const user = signedIn();
    const entry = fakeApi.seedEntry(user.id, { note: 'old note', album: 'Album' });

    const updated = await updateEntry(entry.id, { note: 'new note', album: null });

    expect(updated).toMatchObject({ note: 'new note', album: null, title: entry.title });
  });

  it('rejects null for required fields', async () => {
    const user = signedIn();
    const entry = fakeApi.seedEntry(user.id);

    await expect(updateEntry(entry.id, { title: null as unknown as string })).rejects.toMatchObject(
      {
        fields: { title: 'Cannot be null.' },
      },
    );
  });

  it('rejects moving an entry onto a taken date', async () => {
    const user = signedIn();
    const taken = fakeApi.seedEntry(user.id, { entry_date: '2026-10-10' });
    const entry = fakeApi.seedEntry(user.id, { entry_date: '2026-10-11' });

    await expect(updateEntry(entry.id, { entry_date: '2026-10-10' })).rejects.toMatchObject({
      code: 'entry_exists',
      details: { existing_entry_id: taken.id },
    });
  });

  it('deletes an entry', async () => {
    const user = signedIn();
    const entry = fakeApi.seedEntry(user.id);

    await deleteEntry(entry.id);

    expect(fakeApi.getEntry(entry.id)).toBeUndefined();
  });
});
