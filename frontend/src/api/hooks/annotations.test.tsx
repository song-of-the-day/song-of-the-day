import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { queryKeys } from '@/api/keys';
import type { EntryDetail } from '@/api/types';
import { fakeApi } from '@/test/fakeApi';
import { makeAnnotation } from '@/test/fixtures';
import { renderHookWithProviders } from '@/test/render';

import {
  sortAnnotations,
  useCreateAnnotation,
  useDeleteAnnotation,
  useUpdateAnnotation,
} from './annotations';

function setup() {
  const user = fakeApi.seedUser({ username: 'ada' });
  const entry = fakeApi.seedEntry(user.id);
  const first = fakeApi.seedAnnotation(entry.id, { start_ms: 10_000, body: 'first' });
  const second = fakeApi.seedAnnotation(entry.id, { start_ms: 20_000, body: 'second' });
  const detail = fakeApi.getEntry(entry.id);
  if (detail === undefined) throw new Error('fixture');
  return { user, entry: detail, first, second };
}

function cachedEntry(
  queryClient: ReturnType<typeof renderHookWithProviders>['queryClient'],
  id: number,
) {
  return queryClient.getQueryData<EntryDetail>(queryKeys.entry('ada', id));
}

describe('sortAnnotations', () => {
  it('sorts by start_ms, then id, without mutating the input', () => {
    const input = [
      makeAnnotation({ id: 3, start_ms: 5 }),
      makeAnnotation({ id: 2, start_ms: 5 }),
      makeAnnotation({ id: 1, start_ms: 9 }),
    ];

    expect(sortAnnotations(input).map((annotation) => annotation.id)).toEqual([2, 3, 1]);
    expect(input.map((annotation) => annotation.id)).toEqual([3, 2, 1]);
  });
});

describe('annotation mutations', () => {
  it('useCreateAnnotation inserts the note in order and bumps the count', async () => {
    const { user, entry, first, second } = setup();
    const { result, queryClient } = renderHookWithProviders(() => useCreateAnnotation(), { user });
    queryClient.setQueryData(queryKeys.entry('ada', entry.id), entry);
    queryClient.setQueryData(queryKeys.board('ada'), { pages: [], pageParams: [] });

    const created = await act(() =>
      result.current.mutateAsync({
        entryId: entry.id,
        input: { start_ms: 15_000, body: 'middle' },
      }),
    );

    const cached = cachedEntry(queryClient, entry.id);
    expect(cached?.annotations.map((annotation) => annotation.id)).toEqual([
      first.id,
      created.id,
      second.id,
    ]);
    expect(cached?.annotation_count).toBe(3);
    expect(queryClient.getQueryState(queryKeys.board('ada'))?.isInvalidated).toBe(true);
  });

  it('useUpdateAnnotation replaces and re-sorts the note', async () => {
    const { user, entry, first, second } = setup();
    const { result, queryClient } = renderHookWithProviders(() => useUpdateAnnotation(), { user });
    queryClient.setQueryData(queryKeys.entry('ada', entry.id), entry);

    await act(() =>
      result.current.mutateAsync({ entryId: entry.id, id: first.id, patch: { start_ms: 30_000 } }),
    );

    const cached = cachedEntry(queryClient, entry.id);
    expect(cached?.annotations.map((annotation) => annotation.id)).toEqual([second.id, first.id]);
    expect(cached?.annotations[1]?.start_ms).toBe(30_000);
  });

  it('useDeleteAnnotation removes the note and decrements the count', async () => {
    const { user, entry, first, second } = setup();
    const { result, queryClient } = renderHookWithProviders(() => useDeleteAnnotation(), { user });
    queryClient.setQueryData(queryKeys.entry('ada', entry.id), entry);

    await act(() => result.current.mutateAsync({ entryId: entry.id, id: first.id }));

    const cached = cachedEntry(queryClient, entry.id);
    expect(cached?.annotations.map((annotation) => annotation.id)).toEqual([second.id]);
    expect(cached?.annotation_count).toBe(1);
  });

  it('leaves an uncached entry alone', async () => {
    const { user, entry } = setup();
    const { result, queryClient } = renderHookWithProviders(() => useCreateAnnotation(), { user });

    await act(() =>
      result.current.mutateAsync({ entryId: entry.id, input: { start_ms: 0, body: 'note' } }),
    );

    expect(cachedEntry(queryClient, entry.id)).toBeUndefined();
  });
});
