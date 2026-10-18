import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PASSWORD, fakeApi } from '@/test/fakeApi';
import { server } from '@/test/server';

import {
  changePassword,
  deleteAccount,
  exportData,
  filenameFromContentDisposition,
} from './account';
import { fetchMe } from './auth';

function signedIn() {
  const user = fakeApi.seedUser();
  fakeApi.signIn(user.id);
  return user;
}

describe('filenameFromContentDisposition', () => {
  it.each<[string | null, string | null]>([
    ['attachment; filename="sotd-export-2026-10-11.json"', 'sotd-export-2026-10-11.json'],
    ['attachment; filename=plain.json', 'plain.json'],
    ['attachment; filename = "spaced.json" ; size=10', 'spaced.json'],
    ['attachment; filename="fallback.json"; filename*=UTF-8\'\'caf%C3%A9.json', 'café.json'],
    ['attachment; filename*=UTF-8\'\'bad%E0%A4%A.json; filename="ok.json"', 'ok.json'],
    ['attachment', null],
    ['attachment; filename=""', null],
    [null, null],
  ])('%j → %j', (header, filename) => {
    expect(filenameFromContentDisposition(header)).toBe(filename);
  });
});

describe('changePassword', () => {
  it('changes the password and keeps the session', async () => {
    const user = signedIn();

    await changePassword({ current_password: DEFAULT_PASSWORD, new_password: 'a new password' });

    expect(fakeApi.passwordOf(user.id)).toBe('a new password');
    await expect(fetchMe()).resolves.toMatchObject({ id: user.id });
  });

  it('rejects a wrong current password with invalid_credentials', async () => {
    signedIn();

    await expect(
      changePassword({ current_password: 'not it at all', new_password: 'a new password' }),
    ).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
  });

  it('requires a session', async () => {
    await expect(
      changePassword({ current_password: DEFAULT_PASSWORD, new_password: 'a new password' }),
    ).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
  });
});

describe('exportData', () => {
  it('downloads the export with the server filename', async () => {
    const user = signedIn();
    fakeApi.seedEntry(user.id, { entry_date: '2026-10-01' });

    const { blob, filename } = await exportData();
    const document = JSON.parse(await blob.text()) as { format: string; entries: unknown[] };

    expect(filename).toMatch(/^sotd-export-\d{4}-\d{2}-\d{2}\.json$/);
    expect(document.format).toBe('sotd-export');
    expect(document.entries).toHaveLength(1);
  });

  it('falls back to a default filename', async () => {
    signedIn();
    server.use(http.get('/api/account/export', () => HttpResponse.json({ format: 'sotd-export' })));

    await expect(exportData()).resolves.toMatchObject({ filename: 'sotd-export.json' });
  });
});

describe('deleteAccount', () => {
  it('deletes the account and ends the session', async () => {
    const user = signedIn();

    await deleteAccount({ password: DEFAULT_PASSWORD });

    expect(fakeApi.hasUser(user.id)).toBe(false);
    await expect(fetchMe()).resolves.toBeNull();
  });

  it('rejects a wrong password', async () => {
    const user = signedIn();

    await expect(deleteAccount({ password: 'wrong password' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    expect(fakeApi.hasUser(user.id)).toBe(true);
  });
});
