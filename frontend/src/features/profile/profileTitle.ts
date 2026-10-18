/**
 * How a profile names itself in the document title and the share sheet.
 */
import type { PublicProfile } from '@/api/types';

/**
 * Names a profile for titles.
 *
 * @param profile - The profile.
 * @returns "<display name> (@<username>)", which `DocumentTitle` completes with the app name.
 */
export function profileTitle(profile: Pick<PublicProfile, 'display_name' | 'username'>): string {
  return `${profile.display_name} (@${profile.username})`;
}
