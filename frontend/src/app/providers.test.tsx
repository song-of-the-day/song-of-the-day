import { useQueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { deleteEntry } from '@/api/entries';
import { queryKeys } from '@/api/keys';
import { shouldRetryQuery } from '@/api/queryClient';
import { useToast } from '@/components/ui/useToast';
import { fakeApi } from '@/test/fakeApi';
import { createTestQueryClient } from '@/test/render';

import { AppProviders } from './providers';

function Probe() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        toast.show(
          queryClient.getDefaultOptions().queries?.retry === shouldRetryQuery
            ? 'app defaults'
            : 'other defaults',
        );
      }}
    >
      Probe
    </button>
  );
}

describe('AppProviders', () => {
  it('provides a query client with the app defaults and toasts', async () => {
    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Probe' }));

    expect(screen.getByRole('listitem')).toHaveTextContent('app defaults');
  });

  it('uses a given query client', async () => {
    render(
      <AppProviders queryClient={createTestQueryClient()}>
        <Probe />
      </AppProviders>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Probe' }));

    expect(screen.getByRole('listitem')).toHaveTextContent('other defaults');
  });

  it('logs the user out locally when an API call answers 401 unauthorized', async () => {
    const queryClient = createTestQueryClient();
    const user = fakeApi.seedUser();
    queryClient.setQueryData(queryKeys.me(), user);
    render(
      <AppProviders queryClient={queryClient}>
        <p>App</p>
      </AppProviders>,
    );

    await expect(deleteEntry(1)).rejects.toMatchObject({ code: 'unauthorized' });

    await waitFor(() => {
      expect(queryClient.getQueryData(queryKeys.me())).toBeNull();
    });
  });
});
