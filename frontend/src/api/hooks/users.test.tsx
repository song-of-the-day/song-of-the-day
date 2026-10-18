import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { queryKeys } from '@/api/keys';
import { fakeApi } from '@/test/fakeApi';
import { renderHookWithProviders } from '@/test/render';

import {
  BOARD_PAGE_SIZE,
  useProfileBoardEntries,
  useProfileEntriesRange,
  useProfileEntry,
  usePublicProfile,
  useTodayEntry,
} from './users';

function signedInUser() {
  return fakeApi.seedUser({ username: 'ada' });
}

describe('usePublicProfile', () => {
  it('loads a profile for a logged-out visitor', async () => {
    fakeApi.seedUser({ username: 'ada', display_name: 'Ada' });
    const { result, queryClient } = renderHookWithProviders(() => usePublicProfile('ada'), {
      user: null,
    });

    await waitFor(() => {
      expect(result.current.data).toMatchObject({ username: 'ada', display_name: 'Ada' });
    });
    expect(queryClient.getQueryData(queryKeys.profile('ada'))).toEqual(result.current.data);
  });

  it('errors with not_found for an unknown username', async () => {
    const { result } = renderHookWithProviders(() => usePublicProfile('nobody'), { user: null });

    await waitFor(() => {
      expect(result.current.error).toMatchObject({ code: 'not_found' });
    });
  });
});

describe('useProfileBoardEntries', () => {
  it('loads 60 entries per page, newest first, until there are no more', async () => {
    const user = signedInUser();
    fakeApi.seedEntries(user.id, BOARD_PAGE_SIZE + 5, '2026-10-11');
    const { result } = renderHookWithProviders(() => useProfileBoardEntries('ada'), { user: null });

    await waitFor(() => {
      expect(result.current.data).toHaveLength(BOARD_PAGE_SIZE);
    });
    expect(result.current.data?.[0]?.entry_date).toBe('2026-10-11');
    expect(result.current.hasNextPage).toBe(true);

    await act(() => result.current.fetchNextPage());

    await waitFor(() => {
      expect(result.current.data).toHaveLength(BOARD_PAGE_SIZE + 5);
    });
    expect(result.current.hasNextPage).toBe(false);
    const searches = fakeApi.requests
      .filter((request) => request.path === '/api/users/ada/entries')
      .map((request) => request.search);
    expect(searches).toEqual([
      '?limit=60',
      `?before=${result.current.data?.[59]?.entry_date ?? ''}&limit=60`,
    ]);
  });

  it('is empty for a new user', async () => {
    signedInUser();
    const { result } = renderHookWithProviders(() => useProfileBoardEntries('ada'), { user: null });

    await waitFor(() => {
      expect(result.current.data).toEqual([]);
    });
    expect(result.current.hasNextPage).toBe(false);
  });
});

describe('useProfileEntriesRange / useTodayEntry', () => {
  it('loads a month with a limit covering every day', async () => {
    const user = signedInUser();
    fakeApi.seedEntry(user.id, { entry_date: '2026-10-03' });
    fakeApi.seedEntry(user.id, { entry_date: '2026-09-30' });
    const { result } = renderHookWithProviders(
      () => useProfileEntriesRange('ada', '2026-10-01', '2026-10-31'),
      {
        user: null,
      },
    );

    await waitFor(() => {
      expect(result.current.data?.map((entry) => entry.entry_date)).toEqual(['2026-10-03']);
    });
    expect(fakeApi.requests.at(-1)?.search).toBe('?start=2026-10-01&end=2026-10-31&limit=31');
  });

  it("returns today's entry or null, sharing the range cache", async () => {
    signedInUser();
    const { result, queryClient } = renderHookWithProviders(
      () => useTodayEntry('ada', '2026-10-11'),
      {
        user: null,
      },
    );

    await waitFor(() => {
      expect(result.current.data).toBeNull();
    });
    expect(queryClient.getQueryData(queryKeys.range('ada', '2026-10-11', '2026-10-11'))).toEqual({
      entries: [],
      next_before: null,
    });
    expect(fakeApi.requests.at(-1)?.search).toBe('?start=2026-10-11&end=2026-10-11&limit=1');
  });

  it("finds today's entry", async () => {
    const user = signedInUser();
    const entry = fakeApi.seedEntry(user.id, { entry_date: '2026-10-11' });
    const { result } = renderHookWithProviders(() => useTodayEntry('ada', '2026-10-11'), {
      user: null,
    });

    await waitFor(() => {
      expect(result.current.data?.id).toBe(entry.id);
    });
  });
});

describe('useProfileEntry', () => {
  it('loads one entry with annotations', async () => {
    const user = signedInUser();
    const entry = fakeApi.seedEntry(user.id);
    fakeApi.seedAnnotation(entry.id);
    const { result } = renderHookWithProviders(() => useProfileEntry('ada', entry.id), {
      user: null,
    });

    await waitFor(() => {
      expect(result.current.data?.annotations).toHaveLength(1);
    });
  });

  it("errors with not_found for someone else's entry", async () => {
    signedInUser();
    const other = fakeApi.seedEntry(fakeApi.seedUser().id);
    const { result } = renderHookWithProviders(() => useProfileEntry('ada', other.id), {
      user: null,
    });

    await waitFor(() => {
      expect(result.current.error).toMatchObject({ code: 'not_found' });
    });
  });
});
