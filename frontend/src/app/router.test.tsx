import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { apiErrorResponse, fakeApi } from '@/test/fakeApi';
import { renderApp } from '@/test/routes';
import { server } from '@/test/server';

function failMe(): void {
  server.use(http.get('/api/auth/me', () => apiErrorResponse(500, 'internal_error', 'Boom.')));
}

describe('/', () => {
  it('sends a logged-out visitor to the login page', async () => {
    const { location, router } = renderApp('/');

    expect(await screen.findByRole('heading', { name: 'log in' })).toBeInTheDocument();
    expect(location().pathname).toBe('/login');
    expect(router.state.location.state).toBeNull();
  });

  it('sends a logged-in user to their profile', async () => {
    const user = fakeApi.seedUser({ username: 'ada', display_name: 'Ada' });
    fakeApi.signIn(user.id);
    const { location } = renderApp('/');

    expect(screen.getByRole('status')).toHaveTextContent('Loading your journal…');
    expect(await screen.findByRole('heading', { level: 1, name: 'Ada' })).toBeInTheDocument();
    expect(location().pathname).toBe('/ada');
  });

  it('offers a retry when the session cannot be loaded', async () => {
    failMe();
    const user = fakeApi.seedUser({ username: 'ada', display_name: 'Ada' });
    fakeApi.signIn(user.id);
    const { location } = renderApp('/');

    expect(await screen.findByRole('heading', { name: "can't connect ✦" })).toBeInTheDocument();
    expect(location().pathname).toBe('/');

    server.resetHandlers();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Ada' })).toBeInTheDocument();
  });
});

describe('/profile', () => {
  it('requires logging in and remembers where the user was going', async () => {
    const { location, router } = renderApp('/profile?view=calendar');

    expect(await screen.findByRole('heading', { name: 'log in' })).toBeInTheDocument();
    expect(location().pathname).toBe('/login');
    expect(router.state.location.state).toEqual({
      from: { pathname: '/profile', search: '?view=calendar', hash: '' },
    });
  });

  it("redirects to the user's profile, keeping the search params", async () => {
    const user = fakeApi.seedUser({ username: 'grace', display_name: 'Grace' });
    const entry = fakeApi.seedEntry(user.id);

    const { location } = renderApp(`/profile?view=calendar&entry=${String(entry.id)}`, { user });

    // The `entry` param opens the entry dialog, which hides the page from the accessibility tree.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Grace', hidden: true }),
    ).toBeInTheDocument();
    expect(location().pathname).toBe('/grace');
    expect(location().search).toBe(`?view=calendar&entry=${String(entry.id)}`);
  });

  it('offers a retry instead of the login page when the session cannot be loaded', async () => {
    failMe();
    const user = fakeApi.seedUser({ username: 'grace', display_name: 'Grace' });
    fakeApi.signIn(user.id);
    const { location } = renderApp('/profile');

    expect(await screen.findByRole('heading', { name: "can't connect ✦" })).toBeInTheDocument();
    expect(location().pathname).toBe('/profile');

    server.resetHandlers();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Grace' })).toBeInTheDocument();
  });
});

describe('/:username', () => {
  it('shows a profile to a logged-out visitor, read-only, with ways in', async () => {
    const owner = fakeApi.seedUser({ username: 'grace', display_name: 'Grace' });
    fakeApi.seedEntry(owner.id, { title: 'Teardrop' });

    const { location } = renderApp('/grace', { user: null });

    expect(await screen.findByRole('heading', { level: 1, name: 'Grace' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Open Teardrop/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Start your own' })).toHaveAttribute('href', '/signup');
    expect(screen.queryByRole('button', { name: 'Customize' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "Log today's song" })).not.toBeInTheDocument();
    expect(location().pathname).toBe('/grace');
  });

  it("shows another user's profile to a logged-in visitor without account controls", async () => {
    fakeApi.seedUser({ username: 'grace', display_name: 'Grace' });
    const me = fakeApi.seedUser({ username: 'ada', display_name: 'Ada' });

    renderApp('/grace', { user: me });

    expect(await screen.findByRole('heading', { level: 1, name: 'Grace' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /song of the day/ })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
  });

  it('treats a session that cannot be loaded as logged out', async () => {
    failMe();
    fakeApi.seedUser({ username: 'grace', display_name: 'Grace' });

    renderApp('/grace');

    expect(await screen.findByRole('heading', { level: 1, name: 'Grace' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument();
  });

  it('redirects a username in another case to its lower-case URL', async () => {
    fakeApi.seedUser({ username: 'grace', display_name: 'Grace' });

    const { location } = renderApp('/Grace?view=calendar', { user: null });

    expect(await screen.findByRole('heading', { level: 1, name: 'Grace' })).toBeInTheDocument();
    expect(location().pathname).toBe('/grace');
    expect(location().search).toBe('?view=calendar');
  });

  it("says nobody's here for an unknown username, with a way home", async () => {
    const { location } = renderApp('/nobody', { user: null });

    expect(
      await screen.findByRole('heading', { level: 1, name: "nobody's here ✦" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Nobody's here · song of the day");
    await userEvent.click(screen.getByRole('link', { name: 'Take me home' }));

    await waitFor(() => {
      expect(location().pathname).toBe('/login');
    });
  });

  it("says nobody's here for an impossible username without asking the API", () => {
    renderApp('/no.way', { user: null });

    expect(screen.getByRole('heading', { level: 1, name: "nobody's here ✦" })).toBeInTheDocument();
    expect(fakeApi.requests.some((request) => request.path.startsWith('/api/users'))).toBe(false);
  });

  it('offers a retry when the profile cannot be loaded', async () => {
    fakeApi.seedUser({ username: 'grace', display_name: 'Grace' });
    server.use(
      http.get('/api/users/:username', () => apiErrorResponse(500, 'internal_error', 'Boom.'), {
        once: true,
      }),
    );

    renderApp('/grace', { user: null });

    expect(
      await screen.findByRole('heading', { level: 1, name: "can't load this page ✦" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Grace' })).toBeInTheDocument();
  });

  it('becomes the visitor view when the session ends', async () => {
    const user = fakeApi.seedUser({ username: 'grace', display_name: 'Grace' });
    const { location, queryClient } = renderApp('/grace', { user });
    await screen.findByRole('button', { name: 'Customize' });

    queryClient.setQueryData(['me'], null);

    expect(await screen.findByRole('link', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Customize' })).not.toBeInTheDocument();
    expect(location().pathname).toBe('/grace');
  });
});

describe('logged-out pages', () => {
  it.each(['/login', '/signup', '/forgot-password'])(
    'redirect a logged-in user away from %s',
    async (path) => {
      const user = fakeApi.seedUser({ username: 'ada', display_name: 'Ada' });

      const { location } = renderApp(path, { user });

      await waitFor(() => {
        expect(location().pathname).toBe('/ada');
      });
    },
  );

  it('still show their form when the session cannot be loaded', async () => {
    failMe();

    renderApp('/signup');

    expect(await screen.findByRole('heading', { name: 'sign up' })).toBeInTheDocument();
  });

  it('leave the reset page reachable for a logged-in user', () => {
    const user = fakeApi.seedUser();

    const { location } = renderApp('/reset-password', { user });

    expect(screen.getByRole('heading', { name: 'new password' })).toBeInTheDocument();
    expect(location().pathname).toBe('/reset-password');
  });
});

describe('unknown paths', () => {
  it('show the 404 window with a way home', async () => {
    const { location } = renderApp('/nowhere/at/all', { user: null });

    expect(screen.getByRole('heading', { level: 1, name: '404 ✦ page not found' })).toBeVisible();
    expect(document.title).toBe('Page not found · song of the day');

    await userEvent.click(screen.getByRole('link', { name: 'Take me home' }));

    await waitFor(() => {
      expect(location().pathname).toBe('/login');
    });
  });
});
