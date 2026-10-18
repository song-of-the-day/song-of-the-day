import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { deleteEntry } from '@/api/entries';
import { queryKeys } from '@/api/keys';
import { DEFAULT_PASSWORD, fakeApi } from '@/test/fakeApi';
import { renderHookWithProviders } from '@/test/render';

import {
  useConfirmPasswordReset,
  useLogin,
  useLogout,
  useMe,
  useRequestPasswordReset,
  useSignup,
} from './auth';

describe('useMe', () => {
  it('is null when logged out', async () => {
    const { result } = renderHookWithProviders(() => useMe());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toBeNull();
  });

  it('loads the logged-in user', async () => {
    const user = fakeApi.seedUser({ display_name: 'Grace' });
    fakeApi.signIn(user.id);

    const { result } = renderHookWithProviders(() => useMe());

    await waitFor(() => {
      expect(result.current.data).toEqual(user);
    });
  });
});

describe('useClearMeOnUnauthorized (mounted by the providers)', () => {
  it('clears me when another call answers 401 unauthorized', async () => {
    const user = fakeApi.seedUser();
    const { result, queryClient } = renderHookWithProviders(() => useMe(), { user });
    expect(result.current.data).toEqual(user);
    fakeApi.signOut();

    await expect(deleteEntry(1)).rejects.toMatchObject({ code: 'unauthorized' });

    await waitFor(() => {
      expect(result.current.data).toBeNull();
    });
    expect(queryClient.getQueryData(queryKeys.me())).toBeNull();
  });
});

describe('session mutations', () => {
  it('useSignup caches the new user and drops stale caches', async () => {
    const { result, queryClient } = renderHookWithProviders(() => useSignup(), { user: null });
    queryClient.setQueryData(queryKeys.board('ada'), { pages: [], pageParams: [] });

    await act(() =>
      result.current.mutateAsync({
        email: 'ada@example.com',
        password: 'hunter2hunter2',
        username: 'ada',
      }),
    );

    expect(queryClient.getQueryData(queryKeys.me())).toMatchObject({ email: 'ada@example.com' });
    expect(queryClient.getQueryData(queryKeys.board('ada'))).toBeUndefined();
  });

  it('useLogin caches the user and drops stale caches', async () => {
    const user = fakeApi.seedUser({ email: 'ada@example.com' });
    const { result, queryClient } = renderHookWithProviders(() => useLogin(), { user: null });
    queryClient.setQueryData(queryKeys.entry('ada', 1), { id: 1 });

    await act(() =>
      result.current.mutateAsync({ email: 'ada@example.com', password: DEFAULT_PASSWORD }),
    );

    expect(queryClient.getQueryData(queryKeys.me())).toEqual(user);
    expect(queryClient.getQueryData(queryKeys.entry('ada', 1))).toBeUndefined();
  });

  it('useLogin keeps the cache on invalid credentials', async () => {
    const { result, queryClient } = renderHookWithProviders(() => useLogin(), { user: null });

    await act(async () => {
      await result.current
        .mutateAsync({ email: 'nobody@example.com', password: DEFAULT_PASSWORD })
        .catch(() => undefined);
    });

    await waitFor(() => {
      expect(result.current.error).toMatchObject({ code: 'invalid_credentials' });
    });
    expect(queryClient.getQueryData(queryKeys.me())).toBeNull();
  });

  it('useLogout clears me and every other cache', async () => {
    const user = fakeApi.seedUser();
    const { result, queryClient } = renderHookWithProviders(() => useLogout(), { user });
    queryClient.setQueryData(queryKeys.range('ada', '2026-10-01', '2026-10-31'), {
      entries: [],
      next_before: null,
    });

    await act(() => result.current.mutateAsync());

    expect(queryClient.getQueryData(queryKeys.me())).toBeNull();
    expect(
      queryClient.getQueryData(queryKeys.range('ada', '2026-10-01', '2026-10-31')),
    ).toBeUndefined();
    expect(fakeApi.currentUserId).toBeNull();
  });
});

describe('password reset mutations', () => {
  it('requests and confirms a reset', async () => {
    const user = fakeApi.seedUser({ email: 'ada@example.com' });
    const request = renderHookWithProviders(() => useRequestPasswordReset());
    const confirm = renderHookWithProviders(() => useConfirmPasswordReset());

    await act(() => request.result.current.mutateAsync({ email: 'ada@example.com' }));
    const token = fakeApi.resetTokenFor('ada@example.com') ?? '';
    await act(() => confirm.result.current.mutateAsync({ token, password: 'brand new password' }));

    expect(fakeApi.passwordOf(user.id)).toBe('brand new password');
  });

  it('logs this browser out after a successful reset, since every session was revoked', async () => {
    const user = fakeApi.seedUser({ email: 'ada@example.com' });
    const { result, queryClient } = renderHookWithProviders(
      () => ({ request: useRequestPasswordReset(), confirm: useConfirmPasswordReset() }),
      { user },
    );
    queryClient.setQueryData(queryKeys.board('ada'), { pages: [], pageParams: [] });

    await act(() => result.current.request.mutateAsync({ email: 'ada@example.com' }));
    const token = fakeApi.resetTokenFor('ada@example.com') ?? '';
    await act(() => result.current.confirm.mutateAsync({ token, password: 'brand new password' }));

    expect(queryClient.getQueryData(queryKeys.me())).toBeNull();
    expect(queryClient.getQueryData(queryKeys.board('ada'))).toBeUndefined();
  });

  it('keeps the session when the reset fails', async () => {
    const user = fakeApi.seedUser();
    const { result, queryClient } = renderHookWithProviders(() => useConfirmPasswordReset(), {
      user,
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ token: 'unknown', password: 'brand new password' }),
      ).rejects.toMatchObject({ code: 'invalid_token' });
    });

    expect(queryClient.getQueryData(queryKeys.me())).toEqual(user);
  });
});
