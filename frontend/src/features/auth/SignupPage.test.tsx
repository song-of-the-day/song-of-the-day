import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { queryKeys } from '@/api/keys';
import { apiErrorResponse, fakeApi } from '@/test/fakeApi';
import { renderApp } from '@/test/routes';
import { submitFormOf } from '@/test/forms';
import { holdRequest } from '@/test/hold';
import { server } from '@/test/server';

import { EMAIL_TAKEN_MESSAGE } from './SignupPage';

const LENGTH_MESSAGE = 'Username must be between 3 and 30 characters.';
const TAKEN_MESSAGE = 'Username ada is already taken.';

interface SignupValues {
  username?: string;
  email?: string;
  password?: string;
}

function usernameField() {
  return screen.getByRole('textbox', { name: 'Username' });
}

async function signUp({
  username = 'ada',
  email = 'ada@example.com',
  password = 'a long password',
}: SignupValues = {}) {
  if (username !== '') {
    await userEvent.type(usernameField(), username);
  }
  if (email !== '') {
    await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), email);
  }
  if (password !== '') {
    await userEvent.type(screen.getByLabelText('Password'), password);
  }
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('SignupPage', () => {
  it('renders the three-field signup form with the password policy', () => {
    renderApp('/signup', { user: null });

    expect(screen.getByRole('heading', { level: 1, name: 'sign up' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Username' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Use 8–128 characters.');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.queryByRole('textbox', { name: 'Display name' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  });

  it('creates the account, which starts with the username as display name', async () => {
    const { location, queryClient } = renderApp('/signup', { user: null });

    await signUp({ username: ' Ada_L ', email: 'Ada@Example.com' });

    expect(await screen.findByRole('heading', { level: 1, name: 'ada_l' })).toBeInTheDocument();
    expect(location().pathname).toBe('/ada_l');
    expect(fakeApi.currentUserId).not.toBeNull();
    expect(queryClient.getQueryData(queryKeys.me())).toMatchObject({
      display_name: 'ada_l',
      username: 'ada_l',
      email: 'ada@example.com',
    });
  });

  it('checks the username on blur and again while typing', async () => {
    renderApp('/signup', { user: null });

    await userEvent.type(usernameField(), 'ab');
    expect(usernameField()).not.toHaveAccessibleDescription(LENGTH_MESSAGE);

    await userEvent.tab();
    expect(usernameField()).toHaveAccessibleDescription(LENGTH_MESSAGE);

    await userEvent.type(usernameField(), 'c');
    expect(usernameField()).not.toHaveAccessibleDescription();

    await userEvent.type(usernameField(), '-');
    expect(usernameField()).toHaveAccessibleDescription(
      expect.stringContaining('Username may only contain letters, numbers, hyphens or underscores'),
    );
  });

  it('refuses a reserved username inline before any API call', async () => {
    renderApp('/signup', { user: null });

    await userEvent.type(usernameField(), 'login');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(usernameField()).toHaveAccessibleDescription(
      expect.stringContaining('Username login is unavailable.'),
    );
    expect(fakeApi.requests.some((request) => request.path === '/api/auth/signup')).toBe(false);
  });

  it('shows a taken username on the username field', async () => {
    server.use(
      http.post('/api/auth/signup', () => apiErrorResponse(409, 'username_taken', TAKEN_MESSAGE)),
    );
    const { location } = renderApp('/signup', { user: null });

    await signUp();

    await waitFor(() => {
      expect(usernameField()).toHaveAccessibleDescription(expect.stringContaining(TAKEN_MESSAGE));
    });
    expect(usernameField()).toHaveFocus();
    expect(location().pathname).toBe('/signup');
  });

  it('returns to the page the visitor came from', async () => {
    fakeApi.seedUser({ username: 'grace', display_name: 'Grace' });
    const { location } = renderApp('/grace', { user: null });

    await userEvent.click(await screen.findByRole('link', { name: 'Log in' }));
    await userEvent.click(await screen.findByRole('link', { name: 'Create an account' }));
    await signUp();

    await waitFor(() => {
      expect(location().pathname).toBe('/grace');
    });
  });

  it('validates every field before sending and focuses the first problem', async () => {
    renderApp('/signup', { user: null });

    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(usernameField()).toHaveFocus();
    expect(usernameField()).toHaveAccessibleDescription(
      expect.stringContaining('Username must be between 3 and 30 characters.'),
    );
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAccessibleDescription(
      'Enter your email address.',
    );
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
      'Use 8–128 characters. Enter a password.',
    );
    expect(fakeApi.requests.some((request) => request.path === '/api/auth/signup')).toBe(false);
  });

  it('enforces the password policy', async () => {
    renderApp('/signup', { user: null });

    await signUp({ password: 'short' });

    const password = screen.getByLabelText('Password');
    expect(password).toHaveFocus();
    expect(password).toHaveAccessibleDescription(
      'Use 8–128 characters. Use at least 8 characters.',
    );
  });

  it('shows a taken email on the email field', async () => {
    fakeApi.seedUser({ email: 'ada@example.com' });
    const { location } = renderApp('/signup', { user: null });

    await signUp();

    const email = screen.getByRole('textbox', { name: 'Email' });
    await waitFor(() => {
      expect(email).toHaveAccessibleDescription(EMAIL_TAKEN_MESSAGE);
    });
    expect(email).toHaveFocus();
    expect(location().pathname).toBe('/signup');
    expect(fakeApi.currentUserId).toBeNull();
  });

  it("shows the API's field errors on their fields", async () => {
    server.use(
      http.post('/api/auth/signup', () =>
        apiErrorResponse(422, 'validation_error', 'Some fields are invalid.', {
          fields: {
            username: 'Username ada is unavailable.',
            password: 'Must not be all whitespace.',
          },
        }),
      ),
    );
    renderApp('/signup', { user: null });

    await signUp();

    await waitFor(() => {
      expect(usernameField()).toHaveAccessibleDescription(
        expect.stringContaining('Username ada is unavailable.'),
      );
    });
    expect(usernameField()).toHaveFocus();
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
      'Use 8–128 characters. Must not be all whitespace.',
    );
  });

  it('shows rate limits and other failures as a form error', async () => {
    server.use(
      http.post('/api/auth/signup', () =>
        apiErrorResponse(429, 'rate_limited', 'Too many requests.'),
      ),
    );
    renderApp('/signup', { user: null });

    await signUp();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Wait a few minutes and try again.',
    );
  });

  it('shows a 422 without known fields as a form error', async () => {
    server.use(
      http.post('/api/auth/signup', () =>
        apiErrorResponse(422, 'validation_error', 'Some fields are invalid.', {
          fields: { extra: 'Unknown field.' },
        }),
      ),
    );
    renderApp('/signup', { user: null });

    await signUp();

    expect(await screen.findByRole('alert')).toHaveTextContent('Some fields are invalid.');
  });

  it('ignores repeated submits while the request runs', async () => {
    const held = holdRequest('post', '/api/auth/signup', () =>
      apiErrorResponse(429, 'rate_limited', 'Too many requests.'),
    );
    renderApp('/signup', { user: null });

    await signUp();
    const button = screen.getByRole('button', { name: 'Create account' });
    await waitFor(() => {
      expect(button).toHaveAttribute('aria-busy', 'true');
    });
    await userEvent.click(button);
    submitFormOf('Create account');
    held.release();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(held.calls).toBe(1);
  });
});
