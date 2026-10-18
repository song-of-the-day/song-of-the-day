import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryKeys } from '@/api/keys';
import { saveBlob } from '@/lib/download';
import { apiErrorResponse, DEFAULT_PASSWORD, fakeApi } from '@/test/fakeApi';
import { FIXED_NOW } from '@/test/fixtures';
import { holdRequest } from '@/test/hold';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';

import { AccountDialog } from './AccountDialog';
import {
  ACCOUNT_DELETED_MESSAGE,
  CURRENT_PASSWORD_REQUIRED,
  CURRENT_PASSWORD_WRONG,
  DELETE_PHRASE_MISMATCH,
  EXPORT_STARTED_MESSAGE,
  LOGGED_OUT_MESSAGE,
  PASSWORD_CHANGED_MESSAGE,
  PASSWORD_REQUIRED,
  PASSWORD_WRONG,
  PASSWORDS_DIFFER,
  USERNAME_SAVED_MESSAGE,
} from './copy';

vi.mock('@/lib/download', () => ({ saveBlob: vi.fn() }));

const RATE_LIMITED = 'Too many attempts. Wait a few minutes and try again.';
const NEW_PASSWORD = 'a much better passphrase';

function setup() {
  const user = fakeApi.seedUser({ email: 'ada@example.com' });
  const onOpenChange = vi.fn();
  const view = renderWithProviders(<></>, {
    user,
    route: '/profile',
    routes: [
      { path: '/profile', element: <AccountDialog open onOpenChange={onOpenChange} /> },
      { path: '/login', element: <h1>log in</h1> },
    ],
  });
  return { ...view, user, onOpenChange };
}

function setupUsername(username = 'ada') {
  const user = fakeApi.seedUser({ username, email: 'ada@example.com' });
  const onOpenChange = vi.fn();
  const view = renderWithProviders(<></>, {
    user,
    route: `/${username}`,
    routes: [{ path: '/:username', element: <AccountDialog open onOpenChange={onOpenChange} /> }],
  });
  return { ...view, user, onOpenChange };
}

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

async function changeUsername(to: string) {
  const form = section('Username');
  await userEvent.clear(within(form).getByLabelText('Username'));
  await userEvent.type(within(form).getByLabelText('Username'), to);
  await userEvent.click(within(form).getByRole('button', { name: 'Change username' }));
}

async function fillPasswordForm(current: string, next: string, confirm = next) {
  const form = section('Change password');
  if (current !== '') {
    await userEvent.type(within(form).getByLabelText('Current password'), current);
  }
  await userEvent.type(within(form).getByLabelText('New password'), next);
  await userEvent.type(within(form).getByLabelText('Confirm new password'), confirm);
  await userEvent.click(within(form).getByRole('button', { name: 'Change password' }));
}

async function fillDeleteForm(password: string, phrase: string) {
  const form = section('Delete account');
  if (password !== '') {
    await userEvent.type(within(form).getByLabelText('Your password'), password);
  }
  if (phrase !== '') {
    await userEvent.type(within(form).getByLabelText('Type delete my journal to confirm'), phrase);
  }
  await userEvent.click(within(form).getByRole('button', { name: 'Delete my account' }));
}

describe('AccountDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(saveBlob).mockClear();
  });

  it('shows the account sections and closes', async () => {
    const { onOpenChange } = setup();

    const dialog = screen.getByRole('dialog', { name: 'account' });
    expect(dialog).toHaveAccessibleDescription('Logged in as ada@example.com');
    for (const name of ['Username', 'Change password', 'Export your data', 'Delete account']) {
      expect(section(name)).toBeInTheDocument();
    }
    expect(
      within(section('Change password')).getByLabelText('New password'),
    ).toHaveAccessibleDescription('Use 8–128 characters.');

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  describe('change username', () => {
    it('is disabled until the username changes', () => {
      setupUsername('ada');

      expect(
        within(section('Username')).getByRole('button', { name: 'Change username' }),
      ).toBeDisabled();
    });

    it('changes the username and moves to the new profile URL', async () => {
      const { user, queryClient, location } = setupUsername('ada');

      await changeUsername('ada-lovelace');

      expect(await screen.findByText(USERNAME_SAVED_MESSAGE)).toBeInTheDocument();
      expect(location().pathname).toBe('/ada-lovelace');
      expect(fakeApi.getUser(user.id)?.username).toBe('ada-lovelace');
      expect(queryClient.getQueryData<typeof user>(queryKeys.me())?.username).toBe('ada-lovelace');
    });

    it('shows a taken username inline and stays put', async () => {
      const { location } = setupUsername('ada');
      fakeApi.seedUser({ username: 'grace' });

      await changeUsername('grace');

      const field = within(section('Username')).getByLabelText('Username');
      await waitFor(() => {
        expect(field).toHaveAccessibleDescription(
          expect.stringContaining('Username grace is already taken.'),
        );
      });
      expect(location().pathname).toBe('/ada');
    });

    it('validates the username before sending', async () => {
      setupUsername('ada');

      await changeUsername('no');

      const field = within(section('Username')).getByLabelText('Username');
      expect(field).toHaveFocus();
      expect(field).toHaveAccessibleDescription(
        expect.stringContaining('Username must be between 3 and 30 characters.'),
      );
      expect(fakeApi.requests.some((request) => request.path === '/api/profile')).toBe(false);
    });

    it('maps a server field error to the field', async () => {
      setupUsername('ada');
      server.use(
        http.patch('/api/profile', () =>
          apiErrorResponse(422, 'validation_error', 'Some fields are invalid.', {
            fields: { username: 'That username is not allowed.' },
          }),
        ),
      );

      await changeUsername('ada-l');

      await waitFor(() => {
        expect(within(section('Username')).getByLabelText('Username')).toHaveAccessibleDescription(
          /That username is not allowed\./,
        );
      });
    });
  });

  describe('change password', () => {
    it('changes the password, keeps the session and clears the fields', async () => {
      const { user, queryClient } = setup();

      await fillPasswordForm(DEFAULT_PASSWORD, NEW_PASSWORD);

      expect(await screen.findByText(PASSWORD_CHANGED_MESSAGE)).toBeInTheDocument();
      expect(fakeApi.passwordOf(user.id)).toBe(NEW_PASSWORD);
      expect(queryClient.getQueryData(queryKeys.me())).toEqual(user);
      const form = section('Change password');
      expect(within(form).getByLabelText('Current password')).toHaveValue('');
      expect(within(form).getByLabelText('New password')).toHaveValue('');
      expect(within(form).getByLabelText('Confirm new password')).toHaveValue('');
    });

    it('validates the fields before sending', async () => {
      setup();

      await fillPasswordForm('', 'short', 'other');

      const form = section('Change password');
      expect(within(form).getByLabelText('Current password')).toHaveFocus();
      expect(within(form).getByLabelText('Current password')).toHaveAccessibleDescription(
        CURRENT_PASSWORD_REQUIRED,
      );
      expect(within(form).getByLabelText('New password')).toHaveAccessibleDescription(
        /Use at least 8 characters\./,
      );
      expect(within(form).getByLabelText('Confirm new password')).toHaveAccessibleDescription(
        PASSWORDS_DIFFER,
      );
      expect(fakeApi.requests.some((request) => request.path === '/api/account/password')).toBe(
        false,
      );

      await userEvent.type(within(form).getByLabelText('Current password'), 'x');
      expect(within(form).getByLabelText('Current password')).not.toHaveAccessibleDescription(
        CURRENT_PASSWORD_REQUIRED,
      );
    });

    it('shows a wrong current password inline without logging out', async () => {
      const { user, queryClient } = setup();

      await fillPasswordForm('not my password', NEW_PASSWORD);

      const current = within(section('Change password')).getByLabelText('Current password');
      await waitFor(() => {
        expect(current).toHaveAccessibleDescription(CURRENT_PASSWORD_WRONG);
      });
      expect(current).toHaveFocus();
      expect(queryClient.getQueryData(queryKeys.me())).toEqual(user);
      expect(screen.getByRole('dialog', { name: 'account' })).toBeInTheDocument();
      expect(fakeApi.passwordOf(user.id)).toBe(DEFAULT_PASSWORD);
    });

    it('explains a rate limit', async () => {
      setup();
      server.use(
        http.post('/api/account/password', () =>
          apiErrorResponse(429, 'rate_limited', 'Too many requests.'),
        ),
      );

      await fillPasswordForm(DEFAULT_PASSWORD, NEW_PASSWORD);

      expect(await within(section('Change password')).findByRole('alert')).toHaveTextContent(
        RATE_LIMITED,
      );
    });

    it('maps server field errors to the fields', async () => {
      setup();
      server.use(
        http.post('/api/account/password', () =>
          apiErrorResponse(422, 'validation_error', 'Some fields are invalid.', {
            fields: { new_password: 'Choose a different password.' },
          }),
        ),
      );

      await fillPasswordForm(DEFAULT_PASSWORD, NEW_PASSWORD);

      const next = within(section('Change password')).getByLabelText('New password');
      await waitFor(() => {
        expect(next).toHaveAccessibleDescription(/Choose a different password\./);
      });
      expect(within(section('Change password')).queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('export', () => {
    it('downloads the export with the server filename', async () => {
      setup();

      await userEvent.click(screen.getByRole('button', { name: 'Download my data' }));

      expect(await screen.findByText(EXPORT_STARTED_MESSAGE)).toBeInTheDocument();
      expect(saveBlob).toHaveBeenCalledTimes(1);
      expect(saveBlob).toHaveBeenCalledWith(expect.anything(), 'sotd-export-2026-10-11.json');
      const blob = vi.mocked(saveBlob).mock.calls[0]?.[0];
      expect(JSON.parse((await blob?.text()) ?? 'null')).toMatchObject({
        format: 'sotd-export',
        user: { email: 'ada@example.com' },
      });
    });

    it('shows progress, then the error when the export fails', async () => {
      setup();
      const held = holdRequest('get', '/api/account/export', () =>
        apiErrorResponse(500, 'internal_error', 'Boom', { request_id: 'req-1' }),
      );

      await userEvent.click(screen.getByRole('button', { name: 'Download my data' }));
      await waitFor(() => {
        expect(held.calls).toBe(1);
      });
      expect(screen.getByRole('button', { name: /Download my data/ })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      held.release();

      expect(await within(section('Export your data')).findByRole('alert')).toHaveTextContent(
        'Something went wrong on our side. Please try again. (Reference: req-1)',
      );
      expect(saveBlob).not.toHaveBeenCalled();
    });
  });

  describe('delete account', () => {
    it('requires the password and the typed phrase', async () => {
      const { user } = setup();

      await fillDeleteForm('', 'delete my account');

      const form = section('Delete account');
      expect(within(form).getByLabelText('Your password')).toHaveFocus();
      expect(within(form).getByLabelText('Your password')).toHaveAccessibleDescription(
        PASSWORD_REQUIRED,
      );
      expect(
        within(form).getByLabelText('Type delete my journal to confirm'),
      ).toHaveAccessibleDescription(DELETE_PHRASE_MISMATCH);
      expect(fakeApi.hasUser(user.id)).toBe(true);
    });

    it('shows a wrong password inline', async () => {
      const { user, queryClient } = setup();

      await fillDeleteForm('wrong password', 'delete my journal');

      const password = within(section('Delete account')).getByLabelText('Your password');
      await waitFor(() => {
        expect(password).toHaveAccessibleDescription(PASSWORD_WRONG);
      });
      expect(fakeApi.hasUser(user.id)).toBe(true);
      expect(queryClient.getQueryData(queryKeys.me())).toEqual(user);
    });

    it('explains a rate limit', async () => {
      setup();
      server.use(
        http.delete('/api/account', () => apiErrorResponse(429, 'rate_limited', 'Slow down.')),
      );

      await fillDeleteForm(DEFAULT_PASSWORD, 'delete my journal');

      expect(await within(section('Delete account')).findByRole('alert')).toHaveTextContent(
        RATE_LIMITED,
      );
    });

    it('deletes the account and goes to the login page', async () => {
      const { user, queryClient, location } = setup();

      await fillDeleteForm(DEFAULT_PASSWORD, '  Delete My Journal ');

      expect(await screen.findByRole('heading', { name: 'log in' })).toBeInTheDocument();
      expect(location().pathname).toBe('/login');
      expect(screen.getByText(ACCOUNT_DELETED_MESSAGE)).toBeInTheDocument();
      expect(fakeApi.hasUser(user.id)).toBe(false);
      expect(queryClient.getQueryData(queryKeys.me())).toBeNull();
    });
  });

  describe('log out', () => {
    it('logs out and goes to the login page', async () => {
      const { location, queryClient } = setup();

      await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

      expect(await screen.findByRole('heading', { name: 'log in' })).toBeInTheDocument();
      expect(location().pathname).toBe('/login');
      expect(screen.getByText(LOGGED_OUT_MESSAGE)).toBeInTheDocument();
      expect(fakeApi.currentUserId).toBeNull();
      expect(queryClient.getQueryData(queryKeys.me())).toBeNull();
    });

    it('stays put and explains when logging out fails', async () => {
      const { location } = setup();
      server.use(
        http.post('/api/auth/logout', () => apiErrorResponse(500, 'internal_error', 'Boom')),
      );

      await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

      expect(
        await screen.findByText('Something went wrong on our side. Please try again.'),
      ).toBeInTheDocument();
      expect(location().pathname).toBe('/profile');
      expect(screen.getByRole('dialog', { name: 'account' })).toBeInTheDocument();
    });
  });
});
