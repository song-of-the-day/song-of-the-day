import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { fakeApi } from '@/test/fakeApi';

import { App } from './App';
import { createAppRouter, type AppRouter } from './router';

describe('App', () => {
  let router: AppRouter | undefined;

  function renderApp(): void {
    router = createAppRouter();
    render(<App router={router} />);
  }

  afterEach(() => {
    cleanup();
    router?.dispose();
    router = undefined;
    window.history.replaceState(null, '', '/');
  });

  it('boots into the login page when logged out', async () => {
    window.history.replaceState(null, '', '/');

    renderApp();

    expect(await screen.findByRole('heading', { level: 1, name: 'log in' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });

  it('boots into the profile when logged in', async () => {
    const user = fakeApi.seedUser({ display_name: 'Ada' });
    fakeApi.signIn(user.id);
    window.history.replaceState(null, '', '/profile');

    renderApp();

    expect(await screen.findByRole('heading', { level: 1, name: 'Ada' })).toBeInTheDocument();
  });
});
