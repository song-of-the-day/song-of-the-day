import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { queryKeys } from '@/api/keys';
import { NETWORK_ERROR_MESSAGE } from '@/api/messages';
import { apiErrorResponse, DEFAULT_PASSWORD, fakeApi } from '@/test/fakeApi';
import { renderApp } from '@/test/routes';
import { submitFormOf } from '@/test/forms';
import { holdRequest } from '@/test/hold';
import { server } from '@/test/server';

import { INVALID_CREDENTIALS_MESSAGE } from './LoginPage';

async function logIn(email: string, password: string) {
  await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
}

describe('LoginPage', () => {
  it('renders the login form in the auth window', () => {
    renderApp('/login', { user: null });

    expect(screen.getByRole('heading', { level: 1, name: 'log in' })).toBeInTheDocument();
    expect(document.title).toBe('Log in · song of the day');
    expect(screen.getByRole('checkbox', { name: 'Keep me logged in' })).toBeChecked();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/signup',
    );
  });

  it('logs in and lands on the profile', async () => {
    const user = fakeApi.seedUser({
      email: 'ada@example.com',
      username: 'ada',
      display_name: 'Ada',
    });
    const { location, queryClient } = renderApp('/login', { user: null });

    await logIn(' ada@example.com ', DEFAULT_PASSWORD);

    expect(await screen.findByRole('heading', { level: 1, name: 'Ada' })).toBeInTheDocument();
    expect(location().pathname).toBe('/ada');
    expect(fakeApi.currentUserId).toBe(user.id);
    expect(queryClient.getQueryData(queryKeys.me())).toEqual(user);
  });

  it('returns to the page that required logging in', async () => {
    fakeApi.seedUser({ email: 'ada@example.com', username: 'ada' });
    const { location } = renderApp('/profile?entry=7', { user: null });

    expect(await screen.findByRole('heading', { name: 'log in' })).toBeInTheDocument();
    expect(location().pathname).toBe('/login');

    await logIn('ada@example.com', DEFAULT_PASSWORD);

    await waitFor(() => {
      expect(location().pathname).toBe('/ada');
    });
    expect(location().search).toBe('?entry=7');
  });

  it("returns to someone else's profile after logging in from it", async () => {
    fakeApi.seedUser({ username: 'grace', display_name: 'Grace' });
    fakeApi.seedUser({ email: 'ada@example.com', username: 'ada' });
    const { location } = renderApp('/grace', { user: null });

    await userEvent.click(await screen.findByRole('link', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { name: 'log in' })).toBeInTheDocument();
    await logIn('ada@example.com', DEFAULT_PASSWORD);

    await waitFor(() => {
      expect(location().pathname).toBe('/grace');
    });
  });

  it('sends the "keep me logged in" choice', async () => {
    const user = fakeApi.seedUser({ email: 'ada@example.com' });
    let body: unknown;
    server.use(
      http.post('/api/auth/login', async ({ request }) => {
        body = await request.json();
        fakeApi.signIn(user.id);
        return HttpResponse.json({ user });
      }),
    );
    renderApp('/login', { user: null });

    await userEvent.click(screen.getByRole('checkbox', { name: 'Keep me logged in' }));
    await logIn('ada@example.com', 'whatever pw');

    await waitFor(() => {
      expect(body).toEqual({ email: 'ada@example.com', password: 'whatever pw', remember: false });
    });
  });

  it('validates the fields before sending and focuses the first problem', async () => {
    renderApp('/login', { user: null });

    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    const email = screen.getByRole('textbox', { name: 'Email' });
    expect(email).toHaveAccessibleDescription('Enter your email address.');
    expect(email).toHaveFocus();
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Enter your password.');
    expect(fakeApi.requests.some((request) => request.path === '/api/auth/login')).toBe(false);

    await userEvent.type(email, 'not-an-email');
    expect(email).not.toHaveAttribute('aria-invalid');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(email).toHaveAccessibleDescription('Enter a valid email address.');
  });

  it('shows wrong credentials inline and stays logged out', async () => {
    fakeApi.seedUser({ email: 'ada@example.com' });
    const { location } = renderApp('/login', { user: null });

    await logIn('ada@example.com', 'wrong password');

    expect(await screen.findByRole('alert')).toHaveTextContent(INVALID_CREDENTIALS_MESSAGE);
    expect(location().pathname).toBe('/login');
    expect(fakeApi.currentUserId).toBeNull();
  });

  it('says how long to wait when rate limited', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          { error: { code: 'rate_limited', message: 'Too many requests.' } },
          { status: 429, headers: { 'Retry-After': '600' } },
        ),
      ),
    );
    renderApp('/login', { user: null });

    await logIn('ada@example.com', 'some password');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again in 10 minutes.',
    );
  });

  it('shows the API field errors on their fields', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        apiErrorResponse(422, 'validation_error', 'Some fields are invalid.', {
          fields: { email: 'Contains characters that are not allowed.' },
        }),
      ),
    );
    renderApp('/login', { user: null });

    await logIn('ada@example.com', 'some password');

    const email = screen.getByRole('textbox', { name: 'Email' });
    await waitFor(() => {
      expect(email).toHaveAccessibleDescription('Contains characters that are not allowed.');
    });
    expect(email).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows other failures as a form error', async () => {
    server.use(http.post('/api/auth/login', () => HttpResponse.error()));
    renderApp('/login', { user: null });

    await logIn('ada@example.com', 'some password');

    expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_ERROR_MESSAGE);
  });

  it('clears a field error when the field is edited', async () => {
    renderApp('/login', { user: null });
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('aria-invalid', 'true');

    await userEvent.type(password, 'x');

    expect(password).not.toHaveAttribute('aria-invalid');
  });

  it('redirects a logged-in user to the profile', async () => {
    const user = fakeApi.seedUser({ username: 'grace', display_name: 'Grace' });
    const { location } = renderApp('/login', { user });

    expect(await screen.findByRole('heading', { level: 1, name: 'Grace' })).toBeInTheDocument();
    expect(location().pathname).toBe('/grace');
  });

  it('ignores another submit while logging in', async () => {
    const held = holdRequest('post', '/api/auth/login', () =>
      apiErrorResponse(401, 'invalid_credentials', 'Incorrect email or password.'),
    );
    renderApp('/login', { user: null });

    await logIn('ada@example.com', 'some password');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Log in' })).toHaveAttribute('aria-busy', 'true');
    });
    submitFormOf('Log in');
    held.release();

    expect(await screen.findByRole('alert')).toHaveTextContent(INVALID_CREDENTIALS_MESSAGE);
    expect(held.calls).toBe(1);
  });
});
