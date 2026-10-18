/**
 * Profile endpoint: display name, bio and theme.
 */
import { apiJson } from './client';
import type { ProfilePatch, User } from './types';

/**
 * Updates the profile (`PATCH /api/profile`).
 *
 * @param patch - Any subset of display name, bio and a complete theme.
 * @returns The updated user.
 */
export async function updateProfile(patch: ProfilePatch): Promise<User> {
  const body = await apiJson('/profile', { method: 'PATCH', body: patch });
  return (body as { user: User }).user;
}
