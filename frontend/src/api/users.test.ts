import { describe, expect, it } from 'vitest';

import { fakeApi } from '@/test/fakeApi';

import { getProfileEntry, getPublicProfile, listProfileEntries } from './users';

describe('getPublicProfile', () => {
  it('returns only the public fields, without a session', async () => {
    fakeApi.seedUser({ username: 'ada', display_name: 'Ada', bio: 'breakbeats' });

    const profile = await getPublicProfile('ada');

    expect(profile).toMatchObject({ username: 'ada', display_name: 'Ada', bio: 'breakbeats' });
    expect(Object.keys(profile).sort()).toEqual([
      'bio',
      'created_at',
      'display_name',
      'theme',
      'username',
    ]);
  });

  it('looks the username up case-insensitively', async () => {
    fakeApi.seedUser({ username: 'ada' });

    await expect(getPublicProfile('ADA')).resolves.toMatchObject({ username: 'ada' });
  });

  it('returns not_found for an unknown username', async () => {
    await expect(getPublicProfile('nobody')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('encodes the username in the path', async () => {
    await expect(getPublicProfile('a/b')).rejects.toMatchObject({ status: 404 });
    expect(fakeApi.requests.at(-1)?.path).toBe('/api/users/a%2Fb');
  });
});

describe('listProfileEntries', () => {
  it('pages newest first with the before cursor', async () => {
    const user = fakeApi.seedUser({ username: 'ada' });
    fakeApi.seedEntries(user.id, 5, '2026-10-11');

    const first = await listProfileEntries('ada', { limit: 2 });
    expect(first.entries.map((entry) => entry.entry_date)).toEqual(['2026-10-11', '2026-10-10']);
    expect(first.next_before).toBe('2026-10-10');

    const second = await listProfileEntries('ada', {
      limit: 2,
      before: first.next_before ?? undefined,
    });
    expect(second.entries.map((entry) => entry.entry_date)).toEqual(['2026-10-09', '2026-10-08']);

    const last = await listProfileEntries('ada', {
      limit: 2,
      before: second.next_before ?? undefined,
    });
    expect(last.entries.map((entry) => entry.entry_date)).toEqual(['2026-10-07']);
    expect(last.next_before).toBeNull();
  });

  it('returns no cursor when the page is exactly full', async () => {
    const user = fakeApi.seedUser({ username: 'ada' });
    fakeApi.seedEntries(user.id, 2, '2026-10-11');

    await expect(listProfileEntries('ada', { limit: 2 })).resolves.toMatchObject({
      next_before: null,
    });
  });

  it('filters by an inclusive date range', async () => {
    const user = fakeApi.seedUser({ username: 'ada' });
    fakeApi.seedEntries(user.id, 10, '2026-10-05');

    const page = await listProfileEntries('ada', {
      start: '2026-10-01',
      end: '2026-10-03',
      limit: 31,
    });

    expect(page.entries.map((entry) => entry.entry_date)).toEqual([
      '2026-10-03',
      '2026-10-02',
      '2026-10-01',
    ]);
  });

  it("only returns that user's entries, to anyone", async () => {
    const ada = fakeApi.seedUser({ username: 'ada' });
    const grace = fakeApi.seedUser({ username: 'grace' });
    fakeApi.signIn(grace.id);
    fakeApi.seedEntry(grace.id, { entry_date: '2026-10-11' });
    fakeApi.seedEntry(ada.id, { entry_date: '2026-10-10' });

    const page = await listProfileEntries('ada', {});

    expect(page.entries.map((entry) => entry.entry_date)).toEqual(['2026-10-10']);
  });

  it('rejects start after end', async () => {
    fakeApi.seedUser({ username: 'ada' });

    await expect(
      listProfileEntries('ada', { start: '2026-10-12', end: '2026-10-11' }),
    ).rejects.toMatchObject({
      code: 'validation_error',
      fields: { start: 'Must be on or before end.' },
    });
  });

  it('returns not_found for an unknown username', async () => {
    await expect(listProfileEntries('nobody', {})).rejects.toMatchObject({ status: 404 });
  });
});

describe('getProfileEntry', () => {
  it('reads an entry with its sorted annotations', async () => {
    const user = fakeApi.seedUser({ username: 'ada' });
    const entry = fakeApi.seedEntry(user.id);
    const late = fakeApi.seedAnnotation(entry.id, { start_ms: 90_000 });
    const early = fakeApi.seedAnnotation(entry.id, { start_ms: 10_000 });

    const detail = await getProfileEntry('ada', entry.id);

    expect(detail.annotations.map((annotation) => annotation.id)).toEqual([early.id, late.id]);
    expect(detail.annotation_count).toBe(2);
  });

  it("returns not_found for another user's entry", async () => {
    fakeApi.seedUser({ username: 'ada' });
    const grace = fakeApi.seedUser({ username: 'grace' });
    const entry = fakeApi.seedEntry(grace.id);

    await expect(getProfileEntry('ada', entry.id)).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });
});
