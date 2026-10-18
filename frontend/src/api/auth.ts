/**
 * Auth endpoints: signup, login, logout, current user and password reset.
 */
import { apiJson, apiVoid } from './client';
import { hasErrorCode } from './errors';
import type {
  LoginInput,
  PasswordResetConfirmInput,
  PasswordResetRequestInput,
  SignupInput,
  User,
} from './types';

interface UserEnvelope {
  user: User;
}

/**
 * Creates an account and logs it in (`POST /api/auth/signup`). The display name starts as the
 * username.
 *
 * @param input - Username, email and password.
 * @returns The new user.
 */
export async function signup(input: SignupInput): Promise<User> {
  const body = await apiJson('/auth/signup', {
    method: 'POST',
    body: input,
    rotatesCsrfToken: true,
  });
  return (body as UserEnvelope).user;
}

/**
 * Starts a session (`POST /api/auth/login`).
 *
 * @param input - Credentials and the "keep me logged in" flag.
 * @returns The logged-in user.
 */
export async function login(input: LoginInput): Promise<User> {
  const body = await apiJson('/auth/login', {
    method: 'POST',
    body: input,
    rotatesCsrfToken: true,
  });
  return (body as UserEnvelope).user;
}

/** Ends the current session (`POST /api/auth/logout`). */
export async function logout(): Promise<void> {
  await apiVoid('/auth/logout', { method: 'POST', rotatesCsrfToken: true });
}

/**
 * Loads the logged-in user (`GET /api/auth/me`).
 *
 * @param signal - Aborts the request.
 * @returns The user, or `null` when not logged in.
 */
export async function fetchMe(signal?: AbortSignal): Promise<User | null> {
  try {
    const body = await apiJson('/auth/me', { signal, ignoreUnauthorized: true });
    return (body as UserEnvelope).user;
  } catch (error) {
    if (hasErrorCode(error, 'unauthorized')) {
      return null;
    }
    throw error;
  }
}

/**
 * Asks for a password-reset email (`POST /api/auth/password-reset/request`). The API answers the
 * same way whether or not the account exists.
 *
 * @param input - The account email.
 */
export async function requestPasswordReset(input: PasswordResetRequestInput): Promise<void> {
  await apiVoid('/auth/password-reset/request', { method: 'POST', body: input });
}

/**
 * Sets a new password with a reset token (`POST /api/auth/password-reset/confirm`). It ends every
 * session of the user and does not log in.
 *
 * @param input - The token from the reset link and the new password.
 */
export async function confirmPasswordReset(input: PasswordResetConfirmInput): Promise<void> {
  await apiVoid('/auth/password-reset/confirm', { method: 'POST', body: input });
}
