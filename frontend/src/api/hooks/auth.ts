/**
 * Query and mutation hooks for authentication.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  confirmPasswordReset,
  fetchMe,
  login,
  logout,
  requestPasswordReset,
  signup,
} from '../auth';
import { onUnauthorized } from '../client';
import { queryKeys } from '../keys';
import { endSession, startSession } from './session';

const ME_STALE_TIME_MS = 5 * 60_000;

/**
 * Loads the logged-in user.
 *
 * @returns The query; `data` is the user, `null` when logged out, or `undefined` while loading.
 */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me(),
    queryFn: ({ signal }) => fetchMe(signal),
    staleTime: ME_STALE_TIME_MS,
  });
}

/**
 * Clears `['me']` whenever any API call (other than `/auth/me`) answers `401 unauthorized`, which
 * sends the user to the login page. Mount once, inside the `QueryClientProvider`.
 */
export function useClearMeOnUnauthorized(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      onUnauthorized(() => {
        queryClient.setQueryData(queryKeys.me(), null);
      }),
    [queryClient],
  );
}

/** Signs up; on success the new user is cached as `['me']` and older caches are dropped. */
export function useSignup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: signup,
    onSuccess: (user) => {
      startSession(queryClient, user);
    },
  });
}

/** Logs in; on success the user is cached as `['me']` and older caches are dropped. */
export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      startSession(queryClient, user);
    },
  });
}

/** Logs out; on success `['me']` becomes `null` and every other cache is dropped. */
export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      endSession(queryClient);
    },
  });
}

/** Requests a password-reset email. */
export function useRequestPasswordReset() {
  return useMutation({ mutationFn: requestPasswordReset });
}

/**
 * Sets a new password from a reset token. The API revokes every session of that user, so on
 * success a logged-in user in this browser is logged out too (`['me']` becomes `null`).
 */
export function useConfirmPasswordReset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: confirmPasswordReset,
    onSuccess: () => {
      endSession(queryClient);
    },
  });
}
