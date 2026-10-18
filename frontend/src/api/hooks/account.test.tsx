import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { queryKeys } from '@/api/keys';
import { saveBlob } from '@/lib/download';
import { DEFAULT_PASSWORD, fakeApi } from '@/test/fakeApi';
import { renderHookWithProviders } from '@/test/render';

import { useChangePassword, useDeleteAccount, useExportData } from './account';

vi.mock('@/lib/download', () => ({ saveBlob: vi.fn() }));

describe('account mutations', () => {
  it('useChangePassword changes the password', async () => {
    const user = fakeApi.seedUser();
    const { result } = renderHookWithProviders(() => useChangePassword(), { user });

    await act(() =>
      result.current.mutateAsync({
        current_password: DEFAULT_PASSWORD,
        new_password: 'another password',
      }),
    );

    expect(fakeApi.passwordOf(user.id)).toBe('another password');
  });

  it('useDeleteAccount clears me and every other cache', async () => {
    const user = fakeApi.seedUser();
    const { result, queryClient } = renderHookWithProviders(() => useDeleteAccount(), { user });
    queryClient.setQueryData(queryKeys.entry('ada', 5), { id: 5 });

    await act(() => result.current.mutateAsync({ password: DEFAULT_PASSWORD }));

    expect(queryClient.getQueryData(queryKeys.me())).toBeNull();
    expect(queryClient.getQueryData(queryKeys.entry('ada', 5))).toBeUndefined();
    expect(fakeApi.hasUser(user.id)).toBe(false);
  });

  it('useExportData saves the downloaded file', async () => {
    const user = fakeApi.seedUser();
    const { result } = renderHookWithProviders(() => useExportData(), { user });

    const file = await act(() => result.current.mutateAsync());

    expect(file.filename).toMatch(/^sotd-export-.*\.json$/);
    expect(saveBlob).toHaveBeenCalledWith(file.blob, file.filename);
  });
});
