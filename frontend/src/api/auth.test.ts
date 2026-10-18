import { describe, expect, it } from 'vitest';

import { DEFAULT_PASSWORD, fakeApi } from '@/test/fakeApi';

import { confirmPasswordReset, fetchMe, login, logout, requestPasswordReset, signup } from './auth';
import type { SignupInput } from './types';

function csrfRequests(): number {
  return fakeApi.requests.filter((request) => request.path === '/api/auth/csrf').length;
}

describe('signup', () => {
  it('creates and logs in the user, normalizing the email', async () => {
    const user = await signup({
      email: ' Ada@Example.com ',
      password: 'hunter2hunter2',
      username: ' Ada_L ',
    });

    expect(user).toMatchObject({
      email: 'ada@example.com',
      username: 'ada_l',
      display_name: 'ada_l',
      bio: '',
      autoplay_previews: true,
    });
    expect(user.theme.preset).toBe('chrome');
    expect(fakeApi.currentUserId).toBe(user.id);
  });

  it('rejects a taken email with email_taken', async () => {
    fakeApi.seedUser({ email: 'ada@example.com' });

    await expect(
      signup({
        email: 'ada@example.com',
        password: 'hunter2hunter2',
        username: 'ada',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'email_taken' });
  });

  it('rejects a taken username (case-insensitively) with username_taken', async () => {
    fakeApi.seedUser({ username: 'ada' });

    await expect(
      signup({
        email: 'ada@example.com',
        password: 'hunter2hunter2',
        username: 'ADA',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'username_taken',
      message: 'Username ada is already taken.',
    });
    expect(fakeApi.currentUserId).toBeNull();
  });

  it('reports field errors', async () => {
    await expect(
      signup({ email: 'nope', password: 'short', username: 'login' }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'validation_error',
      fields: {
        email: 'Enter a valid email address.',
        password: 'Must be 8 to 128 characters.',
        username: 'Username login is unavailable.',
      },
    });
  });

  it('requires a username', async () => {
    await expect(
      signup({
        email: 'ada@example.com',
        password: 'hunter2hunter2',
      } as SignupInput),
    ).rejects.toMatchObject({ fields: { username: 'This field is required.' } });
  });

  it('drops the cached CSRF token because the session rotated', async () => {
    await signup({
      email: 'ada@example.com',
      password: 'hunter2hunter2',
      username: 'ada',
    });
    await logout();

    expect(csrfRequests()).toBe(2);
    expect(fakeApi.currentUserId).toBeNull();
  });
});

describe('login / logout / fetchMe', () => {
  it('logs in, loads the user and logs out', async () => {
    const seeded = fakeApi.seedUser({ email: 'grace@example.com' });

    await expect(fetchMe()).resolves.toBeNull();
    await expect(
      login({ email: 'grace@example.com', password: DEFAULT_PASSWORD, remember: false }),
    ).resolves.toEqual(seeded);
    await expect(fetchMe()).resolves.toEqual(seeded);
    await logout();
    await expect(fetchMe()).resolves.toBeNull();
  });

  it('rejects wrong credentials with invalid_credentials', async () => {
    fakeApi.seedUser({ email: 'grace@example.com' });

    await expect(
      login({ email: 'grace@example.com', password: 'wrong password' }),
    ).rejects.toMatchObject({
      status: 401,
      code: 'invalid_credentials',
    });
    await expect(
      login({ email: 'nobody@example.com', password: DEFAULT_PASSWORD }),
    ).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
  });

  it('logout succeeds when already logged out', async () => {
    await expect(logout()).resolves.toBeUndefined();
  });

  it('fetchMe rethrows errors other than unauthorized', async () => {
    const { server } = await import('@/test/server');
    const { http, HttpResponse } = await import('msw');
    server.use(http.get('/api/auth/me', () => HttpResponse.error()));

    await expect(fetchMe()).rejects.toMatchObject({ code: 'network_error' });
  });
});

describe('password reset', () => {
  it('answers the same for known and unknown emails', async () => {
    fakeApi.seedUser({ email: 'ada@example.com' });

    await expect(requestPasswordReset({ email: 'ada@example.com' })).resolves.toBeUndefined();
    await expect(requestPasswordReset({ email: 'nobody@example.com' })).resolves.toBeUndefined();
    expect(fakeApi.resetTokenFor('ada@example.com')).toBeDefined();
    expect(fakeApi.resetTokenFor('nobody@example.com')).toBeUndefined();
  });

  it('sets a new password with a valid token and ends the sessions', async () => {
    const user = fakeApi.seedUser({ email: 'ada@example.com' });
    fakeApi.signIn(user.id);
    await requestPasswordReset({ email: 'ada@example.com' });
    const token = fakeApi.resetTokenFor('ada@example.com') ?? '';

    await confirmPasswordReset({ token, password: 'brand new password' });

    expect(fakeApi.passwordOf(user.id)).toBe('brand new password');
    expect(fakeApi.currentUserId).toBeNull();
    await expect(
      confirmPasswordReset({ token, password: 'another password' }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'invalid_token',
    });
  });

  it('validates the new password before the token', async () => {
    await expect(
      confirmPasswordReset({ token: 'whatever', password: '        ' }),
    ).rejects.toMatchObject({
      code: 'validation_error',
      fields: { password: 'Must not be all whitespace.' },
    });
  });
});
