import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { apiErrorResponse, fakeApi } from '@/test/fakeApi';
import { renderApp } from '@/test/routes';
import { submitFormOf } from '@/test/forms';
import { holdRequest } from '@/test/hold';
import { server } from '@/test/server';

async function requestLink(email: string) {
  await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), email);
  await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
}

describe('ForgotPasswordPage', () => {
  it('renders the request form', () => {
    renderApp('/forgot-password', { user: null });

    expect(screen.getByRole('heading', { level: 1, name: 'forgot password' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  });

  it('confirms the request and sends the email for a known account', async () => {
    fakeApi.seedUser({ email: 'ada@example.com' });
    renderApp('/forgot-password', { user: null });

    await requestLink(' ada@example.com ');

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('check your inbox');
    expect(status).toHaveTextContent('If an account exists for ada@example.com');
    expect(status).toHaveFocus();
    expect(fakeApi.resetTokenFor('ada@example.com')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Back to log in' })).toHaveAttribute('href', '/login');
  });

  it('shows the same confirmation for an unknown email', async () => {
    renderApp('/forgot-password', { user: null });

    await requestLink('nobody@example.com');

    expect(await screen.findByRole('status')).toHaveTextContent(
      'If an account exists for nobody@example.com, we sent it a link',
    );
  });

  it('lets the user try another address', async () => {
    renderApp('/forgot-password', { user: null });
    await requestLink('typo@example.com');
    await screen.findByRole('status');

    await userEvent.click(screen.getByRole('button', { name: 'try another address' }));

    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('typo@example.com');
  });

  it('validates the email before sending', async () => {
    renderApp('/forgot-password', { user: null });

    await requestLink('nope');

    const email = screen.getByRole('textbox', { name: 'Email' });
    expect(email).toHaveAccessibleDescription('Enter a valid email address.');
    expect(email).toHaveFocus();
    expect(fakeApi.requests.some((request) => request.path.includes('password-reset'))).toBe(false);
  });

  it("shows the API's email error", async () => {
    server.use(
      http.post('/api/auth/password-reset/request', () =>
        apiErrorResponse(422, 'validation_error', 'Some fields are invalid.', {
          fields: { email: 'Enter a valid email address.' },
        }),
      ),
    );
    renderApp('/forgot-password', { user: null });

    await requestLink('ada@example.com');

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAccessibleDescription(
        'Enter a valid email address.',
      );
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('reports a rate limit instead of confirming', async () => {
    server.use(
      http.post('/api/auth/password-reset/request', () =>
        apiErrorResponse(429, 'rate_limited', 'Too many requests.'),
      ),
    );
    renderApp('/forgot-password', { user: null });

    await requestLink('ada@example.com');

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts.');
    expect(screen.queryByText(/check your inbox/)).not.toBeInTheDocument();
  });

  it('ignores another submit while sending', async () => {
    const held = holdRequest(
      'post',
      '/api/auth/password-reset/request',
      () => new Response('{}', { status: 202, headers: { 'Content-Type': 'application/json' } }),
    );
    renderApp('/forgot-password', { user: null });

    await requestLink('ada@example.com');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send reset link' })).toHaveAttribute(
        'aria-busy',
        'true',
      );
    });
    submitFormOf('Send reset link');
    held.release();

    expect(await screen.findByRole('status')).toHaveTextContent('check your inbox');
    expect(held.calls).toBe(1);
  });
});
