import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { requestPasswordReset } from '@/api/auth';
import { queryKeys } from '@/api/keys';
import { SERVER_ERROR_MESSAGE } from '@/api/messages';
import { apiErrorResponse, fakeApi } from '@/test/fakeApi';
import { renderApp } from '@/test/routes';
import { submitFormOf } from '@/test/forms';
import { holdRequest } from '@/test/hold';
import { server } from '@/test/server';

import { INVALID_LINK_MESSAGE } from './ResetPasswordPage';

async function issueToken(email = 'ada@example.com'): Promise<string> {
  await requestPasswordReset({ email });
  const token = fakeApi.resetTokenFor(email);
  if (token === undefined) {
    throw new Error('no reset token issued');
  }
  return token;
}

async function setPassword(password: string, confirm = password) {
  await userEvent.type(screen.getByLabelText('New password'), password);
  await userEvent.type(screen.getByLabelText('Confirm new password'), confirm);
  await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
}

describe('ResetPasswordPage', () => {
  it('removes the token from the address right away', async () => {
    const { location } = renderApp('/reset-password#token=secret-token', { user: null });

    await waitFor(() => {
      expect(location().hash).toBe('');
    });
    expect(location().pathname).toBe('/reset-password');
    expect(screen.getByRole('heading', { level: 1, name: 'new password' })).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(
      'Use 8–128 characters.',
    );
  });

  it('sets the new password and offers to log in', async () => {
    const user = fakeApi.seedUser({ email: 'ada@example.com' });
    const token = await issueToken();
    const { location } = renderApp(`/reset-password#token=${token}`, { user: null });

    await setPassword('my brand new password');

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('password changed');
    expect(status).toHaveFocus();
    expect(fakeApi.passwordOf(user.id)).toBe('my brand new password');

    await userEvent.click(screen.getByRole('link', { name: 'Log in' }));
    expect(location().pathname).toBe('/login');
  });

  it('checks the policy and the confirmation before sending', async () => {
    renderApp('/reset-password#token=abc', { user: null });

    await setPassword('short', 'different');

    const password = screen.getByLabelText('New password');
    expect(password).toHaveFocus();
    expect(password).toHaveAccessibleDescription(
      'Use 8–128 characters. Use at least 8 characters.',
    );
    expect(screen.getByLabelText('Confirm new password')).toHaveAccessibleDescription(
      "Passwords don't match.",
    );
    expect(fakeApi.requests.some((request) => request.path.endsWith('/confirm'))).toBe(false);
  });

  it('shows the invalid-link state for an unknown or expired token', async () => {
    renderApp('/reset-password#token=expired', { user: null });

    await setPassword('my brand new password');

    expect(await screen.findByText(new RegExp(INVALID_LINK_MESSAGE))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('shows the invalid-link state when the link has no token', () => {
    renderApp('/reset-password', { user: null });

    expect(screen.getByText(new RegExp(INVALID_LINK_MESSAGE))).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('treats a rejected token field as an invalid link', async () => {
    server.use(
      http.post('/api/auth/password-reset/confirm', () =>
        apiErrorResponse(422, 'validation_error', 'Some fields are invalid.', {
          fields: { token: 'Must be a single line.' },
        }),
      ),
    );
    renderApp('/reset-password#token=abc', { user: null });

    await setPassword('my brand new password');

    expect(await screen.findByText(new RegExp(INVALID_LINK_MESSAGE))).toBeInTheDocument();
  });

  it("shows the API's password error on the field", async () => {
    server.use(
      http.post('/api/auth/password-reset/confirm', () =>
        apiErrorResponse(422, 'validation_error', 'Some fields are invalid.', {
          fields: { password: 'Must not be all whitespace.' },
        }),
      ),
    );
    renderApp('/reset-password#token=abc', { user: null });

    await setPassword('my brand new password');

    const password = screen.getByLabelText('New password');
    await waitFor(() => {
      expect(password).toHaveAccessibleDescription(
        'Use 8–128 characters. Must not be all whitespace.',
      );
    });
    expect(password).toHaveFocus();
  });

  it('shows other failures as a form error and keeps the form', async () => {
    server.use(
      http.post('/api/auth/password-reset/confirm', () =>
        HttpResponse.text('Bad Gateway', { status: 502 }),
      ),
    );
    renderApp('/reset-password#token=abc', { user: null });

    await setPassword('my brand new password');

    expect(await screen.findByRole('alert')).toHaveTextContent(SERVER_ERROR_MESSAGE);
    expect(screen.getByLabelText('New password')).toHaveValue('my brand new password');
  });

  it('is available to a logged-in user and logs them out on success', async () => {
    const user = fakeApi.seedUser({ email: 'ada@example.com' });
    const token = await issueToken();
    const { queryClient } = renderApp(`/reset-password#token=${token}`, { user });

    await setPassword('my brand new password');

    await screen.findByRole('status');
    expect(queryClient.getQueryData(queryKeys.me())).toBeNull();
    expect(fakeApi.currentUserId).toBeNull();
  });

  it('ignores another submit while saving', async () => {
    const held = holdRequest('post', '/api/auth/password-reset/confirm', () =>
      apiErrorResponse(400, 'invalid_token', 'This reset link is invalid or has expired.'),
    );
    renderApp('/reset-password#token=abc', { user: null });

    await setPassword('my brand new password');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Set new password' })).toHaveAttribute(
        'aria-busy',
        'true',
      );
    });
    submitFormOf('Set new password');
    held.release();

    expect(await screen.findByText(new RegExp(INVALID_LINK_MESSAGE))).toBeInTheDocument();
    expect(held.calls).toBe(1);
  });
});
