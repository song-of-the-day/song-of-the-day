import { Link, useLocation } from 'react-router';

import type { PublicProfile } from '@/api/types';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { Wordmark } from '@/components/ui/Wordmark';
import { fromState } from '@/features/auth/redirect';

import { ShareButton } from './ShareButton';

export interface ProfileHeaderProps {
  profile: PublicProfile;
  /** Owner mode shows [Share] and keeps the wordmark as plain branding. */
  isOwner?: boolean;
  /**
   * Visitor mode (`isOwner` false): whether the visitor is logged in. The wordmark links home
   * either way; logged-out visitors also get [Log in] / [Start your own]. Ignored for the owner.
   */
  loggedIn?: boolean;
}

/**
 * Whether the header shows "@username" under the display name: only when the two differ,
 * ignoring case (a display name equal to the username shows just once).
 */
function showsUsername({ display_name, username }: PublicProfile): boolean {
  return display_name.toLowerCase() !== username.toLowerCase();
}

/**
 * The profile's header panel: wordmark, display name, "@username" when it
 * differs from the display name, and bio. For the owner it also holds [Share]; the owner's
 * [Customize] and [Account] live in the floating footer ({@link ProfileDock}). In visitor mode the
 * wordmark links home and logged-out visitors get [Log in] / [Start your own] — there is no
 * separate top bar.
 */
export function ProfileHeader({ profile, isOwner = false, loggedIn = false }: ProfileHeaderProps) {
  const location = useLocation();
  return (
    <header className="y2k-window flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
      <div className="min-w-0">
        {isOwner ? (
          <Wordmark size="sm" className="text-muted" />
        ) : (
          <Link
            to="/"
            className="inline-block rounded-sm text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Wordmark as="span" size="sm" />
          </Link>
        )}
        <h1 className="mt-1 font-heading text-2xl break-words text-fg sm:text-3xl">
          {profile.display_name}
        </h1>
        {showsUsername(profile) && (
          <p className="text-sm break-all text-muted">@{profile.username}</p>
        )}
        {profile.bio !== '' && (
          <p className="mt-1 text-sm break-words whitespace-pre-line text-muted">{profile.bio}</p>
        )}
      </div>
      {isOwner ? (
        <div className="flex shrink-0 flex-wrap gap-2">
          <ShareButton profile={profile} />
        </div>
      ) : (
        !loggedIn && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link
              to="/login"
              state={fromState(location)}
              className={buttonClassName({ variant: 'secondary', size: 'sm' })}
            >
              Log in
            </Link>
            <Link to="/signup" className={buttonClassName({ size: 'sm' })}>
              Start your own
            </Link>
          </div>
        )
      )}
    </header>
  );
}
