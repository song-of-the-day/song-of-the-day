/**
 * Mutation hooks for the profile and background image uploads.
 */
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { queryKeys } from '../keys';
import { updateProfile } from '../profile';
import type { User } from '../types';
import { uploadImage } from '../uploads';
import { ownerUsername, publicProfileOf } from './owner';

export interface UpdateProfileOptions {
  /**
   * Called after a save that changed the username, with the new one; navigate to the new URL
   * here. The old username's queries are removed once it settles.
   */
  onUsernameChange?: (username: string) => void | Promise<void>;
}

/**
 * Updates the username, display name, bio, theme and/or auto-play preference. On success
 * `['me']` and `['users', username, 'profile']` hold the updated user; after a username change
 * the old username's cache is dropped (its link no longer works).
 *
 * @param options - Username-change handling.
 * @returns The mutation.
 */
export function useUpdateProfile({ onUsernameChange }: UpdateProfileOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProfile,
    onSuccess: async (user: User) => {
      const previous = ownerUsername(queryClient);
      queryClient.setQueryData(queryKeys.profile(user.username), publicProfileOf(user));
      queryClient.setQueryData(queryKeys.me(), user);
      if (previous !== null && previous !== user.username) {
        await onUsernameChange?.(user.username);
        queryClient.removeQueries({ queryKey: queryKeys.user(previous) });
      }
    },
  });
}

/** Uploads a background image; reference the result in the draft theme, then save the profile. */
export function useUploadImage() {
  return useMutation({ mutationFn: uploadImage });
}

/**
 * Saves the "auto-play previews" preference immediately, optimistically: `['me']` changes at
 * once and reverts if the save fails.
 *
 * @returns The mutation; its variable is the new preference.
 */
export function useSetAutoplayPreviews() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => updateProfile({ autoplay_previews: enabled }),
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.me() });
      const previous = queryClient.getQueryData<User | null>(queryKeys.me());
      setAutoplay(queryClient, enabled);
      return { previous: previous?.autoplay_previews };
    },
    onError: (_error, _enabled, context) => {
      if (context?.previous !== undefined) {
        setAutoplay(queryClient, context.previous);
      }
    },
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me(), user);
    },
  });
}

function setAutoplay(queryClient: QueryClient, enabled: boolean): void {
  queryClient.setQueryData<User | null>(queryKeys.me(), (user) =>
    user === undefined || user === null ? user : { ...user, autoplay_previews: enabled },
  );
}
