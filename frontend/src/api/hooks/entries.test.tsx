import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { existingEntryId } from '@/api/errors';
import { queryKeys } from '@/api/keys';
import type { EntryDetail } from '@/api/types';
import { fakeApi } from '@/test/fakeApi';
import { renderHookWithProviders } from '@/test/render';

import { useCreateEntry, useDeleteEntry, useUpdateEntry } from './entries';
import { useProfileBoardEntries } from './users';

function signedInUser() {
  return fakeApi.seedUser();
}

describe('entry mutations', () => {
  it('useCreateEntry caches the entry and refreshes active lists', async () => {
    const user = signedInUser();
    const { result, queryClient } = renderHookWithProviders(
      () => ({ board: useProfileBoardEntries(user.username), create: useCreateEntry() }),
      { user },
    );
    await waitFor(() => {
      expect(result.current.board.data).toEqual([]);
    });

    const created = await act(() =>
      result.current.create.mutateAsync({
        entry_date: '2026-10-11',
        title: 'Gosh',
        artist: 'Jamie xx',
      }),
    );

    expect(queryClient.getQueryData(queryKeys.entry(user.username, created.id))).toEqual(created);
    await waitFor(() => {
      expect(result.current.board.data?.map((entry) => entry.id)).toEqual([created.id]);
    });
  });

  it('useCreateEntry exposes the existing entry on entry_exists', async () => {
    const user = signedInUser();
    const existing = fakeApi.seedEntry(user.id, { entry_date: '2026-10-11' });
    const { result } = renderHookWithProviders(() => useCreateEntry(), { user });

    await act(async () => {
      await result.current
        .mutateAsync({ entry_date: '2026-10-11', title: 'Other', artist: 'Someone' })
        .catch(() => undefined);
    });

    await waitFor(() => {
      expect(existingEntryId(result.current.error)).toBe(existing.id);
    });
  });

  it('useUpdateEntry replaces the cached entry and invalidates lists', async () => {
    const user = signedInUser();
    const entry = fakeApi.seedEntry(user.id, { entry_date: '2026-10-11' });
    const { result, queryClient } = renderHookWithProviders(() => useUpdateEntry(), { user });
    queryClient.setQueryData(queryKeys.board(user.username), { pages: [], pageParams: [] });

    await act(() => result.current.mutateAsync({ id: entry.id, patch: { note: 'edited' } }));

    expect(
      queryClient.getQueryData<EntryDetail>(queryKeys.entry(user.username, entry.id))?.note,
    ).toBe('edited');
    expect(queryClient.getQueryState(queryKeys.board(user.username))?.isInvalidated).toBe(true);
  });

  it('useDeleteEntry removes the cached entry and invalidates lists', async () => {
    const user = signedInUser();
    const entry = fakeApi.seedEntry(user.id);
    const { result, queryClient } = renderHookWithProviders(() => useDeleteEntry(), { user });
    queryClient.setQueryData(queryKeys.entry(user.username, entry.id), entry);
    queryClient.setQueryData(queryKeys.range(user.username, '2026-10-11', '2026-10-11'), {
      entries: [],
      next_before: null,
    });

    await act(() => result.current.mutateAsync(entry.id));

    expect(queryClient.getQueryData(queryKeys.entry(user.username, entry.id))).toBeUndefined();
    expect(
      queryClient.getQueryState(queryKeys.range(user.username, '2026-10-11', '2026-10-11'))
        ?.isInvalidated,
    ).toBe(true);
    expect(fakeApi.getEntry(entry.id)).toBeUndefined();
  });
});

describe('entry mutations without a cached user', () => {
  it('invalidate every profile list', async () => {
    const user = fakeApi.seedUser();
    fakeApi.signIn(user.id);
    const entry = fakeApi.seedEntry(user.id);
    const { result, queryClient } = renderHookWithProviders(() => ({
      update: useUpdateEntry(),
      remove: useDeleteEntry(),
    }));
    queryClient.setQueryData(queryKeys.board('someone'), { pages: [], pageParams: [] });

    await act(() => result.current.update.mutateAsync({ id: entry.id, patch: { note: 'x' } }));
    expect(queryClient.getQueryState(queryKeys.board('someone'))?.isInvalidated).toBe(true);

    queryClient.setQueryData(queryKeys.board('someone'), { pages: [], pageParams: [] });
    await act(() => result.current.remove.mutateAsync(entry.id));
    expect(queryClient.getQueryState(queryKeys.board('someone'))?.isInvalidated).toBe(true);
  });
});
