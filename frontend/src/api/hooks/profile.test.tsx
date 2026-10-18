import { act, waitFor } from '@testing-library/react';
import { http } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { queryKeys } from '@/api/keys';
import type { User } from '@/api/types';
import { apiErrorResponse, fakeApi } from '@/test/fakeApi';
import { renderHookWithProviders } from '@/test/render';
import { server } from '@/test/server';

import { useSetAutoplayPreviews, useUpdateProfile, useUploadImage } from './profile';

describe('useUpdateProfile', () => {
  it('puts the updated user into me and its public profile', async () => {
    const user = fakeApi.seedUser({ username: 'ada' });
    const { result, queryClient } = renderHookWithProviders(() => useUpdateProfile(), { user });

    await act(() => result.current.mutateAsync({ display_name: 'Grace', bio: 'synths' }));

    expect(queryClient.getQueryData(queryKeys.me())).toMatchObject({
      id: user.id,
      display_name: 'Grace',
      bio: 'synths',
    });
    expect(queryClient.getQueryData(queryKeys.profile('ada'))).toEqual({
      username: 'ada',
      display_name: 'Grace',
      bio: 'synths',
      theme: user.theme,
      created_at: user.created_at,
    });
  });

  it('after a username change, reports it and then drops the old username', async () => {
    const user = fakeApi.seedUser({ username: 'ada' });
    const order: string[] = [];
    const onUsernameChange = vi.fn((username: string) => {
      order.push(`navigate:${username}`);
    });
    const { result, queryClient } = renderHookWithProviders(
      () => useUpdateProfile({ onUsernameChange }),
      { user },
    );
    queryClient.setQueryData(queryKeys.board('ada'), { pages: [], pageParams: [] });
    queryClient.setQueryData(queryKeys.board('grace'), { pages: [], pageParams: [] });

    await act(() => result.current.mutateAsync({ username: 'Ada-L' }));

    expect(onUsernameChange).toHaveBeenCalledWith('ada-l');
    expect(order).toEqual(['navigate:ada-l']);
    expect(queryClient.getQueryData<User>(queryKeys.me())?.username).toBe('ada-l');
    expect(queryClient.getQueryData(queryKeys.profile('ada-l'))).toMatchObject({
      username: 'ada-l',
    });
    expect(queryClient.getQueryData(queryKeys.board('ada'))).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.profile('ada'))).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.board('grace'))).toBeDefined();
  });

  it('keeps the cache when the username is unchanged', async () => {
    const user = fakeApi.seedUser({ username: 'ada' });
    const onUsernameChange = vi.fn();
    const { result, queryClient } = renderHookWithProviders(
      () => useUpdateProfile({ onUsernameChange }),
      { user },
    );
    queryClient.setQueryData(queryKeys.board('ada'), { pages: [], pageParams: [] });

    await act(() => result.current.mutateAsync({ username: 'ADA' }));

    expect(onUsernameChange).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(queryKeys.board('ada'))).toBeDefined();
  });

  it('reports username_taken', async () => {
    fakeApi.seedUser({ username: 'grace' });
    const user = fakeApi.seedUser({ username: 'ada' });
    const { result } = renderHookWithProviders(() => useUpdateProfile(), { user });

    await expect(
      act(() => result.current.mutateAsync({ username: 'grace' })),
    ).rejects.toMatchObject({ status: 409, code: 'username_taken' });
  });
});

describe('useSetAutoplayPreviews', () => {
  it('updates me at once and keeps the saved user', async () => {
    const user = fakeApi.seedUser();
    const { result, queryClient } = renderHookWithProviders(() => useSetAutoplayPreviews(), {
      user,
    });

    act(() => {
      result.current.mutate(false);
    });

    await waitFor(() => {
      expect(queryClient.getQueryData<User>(queryKeys.me())?.autoplay_previews).toBe(false);
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(fakeApi.getUser(user.id)?.autoplay_previews).toBe(false);
  });

  it('reverts when the save fails', async () => {
    server.use(http.patch('/api/profile', () => apiErrorResponse(500, 'internal_error', 'Boom.')));
    const user = fakeApi.seedUser();
    const { result, queryClient } = renderHookWithProviders(() => useSetAutoplayPreviews(), {
      user,
    });

    await expect(act(() => result.current.mutateAsync(false))).rejects.toMatchObject({
      code: 'internal_error',
    });

    expect(queryClient.getQueryData<User>(queryKeys.me())?.autoplay_previews).toBe(true);
  });

  it('leaves a logged-out cache alone', async () => {
    const { result, queryClient } = renderHookWithProviders(() => useSetAutoplayPreviews(), {
      user: null,
    });

    await expect(act(() => result.current.mutateAsync(false))).rejects.toMatchObject({
      status: 401,
    });

    expect(queryClient.getQueryData(queryKeys.me())).toBeNull();
  });
});

describe('useUploadImage', () => {
  it('returns the stored upload', async () => {
    const user = fakeApi.seedUser();
    const { result } = renderHookWithProviders(() => useUploadImage(), { user });

    const upload = await act(() =>
      result.current.mutateAsync(new File(['x'], 'bg.png', { type: 'image/png' })),
    );

    expect(fakeApi.hasUpload(upload.id)).toBe(true);
  });
});
