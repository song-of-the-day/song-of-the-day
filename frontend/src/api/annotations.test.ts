import { describe, expect, it } from 'vitest';

import { fakeApi } from '@/test/fakeApi';

import {
  createAnnotation,
  deleteAnnotation,
  listAnnotations,
  updateAnnotation,
} from './annotations';

function entryOfSignedInUser() {
  const user = fakeApi.seedUser();
  fakeApi.signIn(user.id);
  return fakeApi.seedEntry(user.id);
}

describe('annotations', () => {
  it('creates point and range notes with defaults', async () => {
    const entry = entryOfSignedInUser();

    const point = await createAnnotation(entry.id, { start_ms: 5_000, body: ' drop ' });
    const range = await createAnnotation(entry.id, {
      start_ms: 1_000,
      end_ms: 3_000,
      body: 'intro',
      color: 'pink',
    });

    expect(point).toMatchObject({
      entry_id: entry.id,
      end_ms: null,
      body: 'drop',
      color: 'yellow',
    });
    expect(range).toMatchObject({ end_ms: 3_000, color: 'pink' });
    await expect(listAnnotations(entry.id)).resolves.toEqual([range, point]);
  });

  it('validates the range', async () => {
    const entry = entryOfSignedInUser();

    await expect(
      createAnnotation(entry.id, { start_ms: 5_000, end_ms: 5_000, body: 'x' }),
    ).rejects.toMatchObject({ fields: { end_ms: 'Must be greater than start_ms.' } });
  });

  it('turns a range into a point with end_ms null', async () => {
    const entry = entryOfSignedInUser();
    const annotation = fakeApi.seedAnnotation(entry.id, { start_ms: 1_000, end_ms: 2_000 });

    await expect(
      updateAnnotation(entry.id, annotation.id, { end_ms: null }),
    ).resolves.toMatchObject({
      end_ms: null,
      start_ms: 1_000,
    });
  });

  it('checks the merged range on update', async () => {
    const entry = entryOfSignedInUser();
    const annotation = fakeApi.seedAnnotation(entry.id, { start_ms: 1_000, end_ms: 2_000 });

    await expect(
      updateAnnotation(entry.id, annotation.id, { start_ms: 2_500 }),
    ).rejects.toMatchObject({
      fields: { end_ms: 'Must be greater than start_ms.' },
    });
  });

  it('rejects the 201st note', async () => {
    const entry = entryOfSignedInUser();
    for (let index = 0; index < 200; index += 1) {
      fakeApi.seedAnnotation(entry.id, { start_ms: index });
    }

    await expect(
      createAnnotation(entry.id, { start_ms: 0, body: 'one too many' }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'annotation_limit_reached',
    });
  });

  it("returns not_found for another entry's annotation", async () => {
    const entry = entryOfSignedInUser();
    const other = fakeApi.seedEntry(fakeApi.currentUserId ?? 0, { entry_date: '2026-01-01' });
    const foreign = fakeApi.seedAnnotation(other.id);

    await expect(deleteAnnotation(entry.id, foreign.id)).rejects.toMatchObject({ status: 404 });
    await expect(updateAnnotation(entry.id, foreign.id, { body: 'x' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('deletes an annotation', async () => {
    const entry = entryOfSignedInUser();
    const annotation = fakeApi.seedAnnotation(entry.id);

    await deleteAnnotation(entry.id, annotation.id);

    await expect(listAnnotations(entry.id)).resolves.toEqual([]);
  });
});
