import { Link, Navigate, useLocation, useParams } from 'react-router';

import { hasErrorCode } from '@/api/errors';
import { useMe } from '@/api/hooks/auth';
import { usePublicProfile } from '@/api/hooks/users';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { Button } from '@/components/ui/Button';
import { CenteredPage } from '@/components/ui/CenteredPage';
import { DocumentTitle } from '@/components/ui/DocumentTitle';
import { Spinner } from '@/components/ui/Spinner';
import { Window } from '@/components/ui/Window';
import { profilePath } from '@/features/auth/redirect';
import { isValidUsername, normalizeUsername } from '@/lib/username';

import { ProfilePage } from './ProfilePage';

export const NOBODY_HERE_TITLE = "nobody's here ✦";

/** An unknown (or impossible) username: a friendly dead end with a way home. */
export function NobodyHere() {
  return (
    <CenteredPage>
      <DocumentTitle title="Nobody's here" />
      <Window
        title={NOBODY_HERE_TITLE}
        headingLevel={1}
        className="w-full max-w-sm"
        bodyClassName="flex flex-col items-start gap-4 p-6"
      >
        <p className="text-sm text-fg">
          There&apos;s no journal at this link. It may have moved to a new name.
        </p>
        <Link to="/" className={buttonClassName()}>
          Take me home
        </Link>
      </Window>
    </CenteredPage>
  );
}

interface ProfileLoaderProps {
  username: string;
}

function ProfileLoader({ username }: ProfileLoaderProps) {
  const me = useMe();
  const profile = usePublicProfile(username);

  if (hasErrorCode(profile.error, 'not_found') && profile.data === undefined) {
    return <NobodyHere />;
  }
  // A session that can't be loaded doesn't block a public page: it shows as logged out.
  const sessionPending = me.data === undefined && !me.isError;
  if (profile.data !== undefined && !sessionPending) {
    return <ProfilePage profile={profile.data} viewer={me.data ?? null} />;
  }
  if (profile.isError) {
    return (
      <CenteredPage>
        <DocumentTitle title="Can't load this page" />
        <Window
          title="can't load this page ✦"
          headingLevel={1}
          className="w-full max-w-sm"
          bodyClassName="flex flex-col gap-4 p-6"
        >
          <p className="text-sm text-fg">
            We couldn&apos;t load this journal. Check your connection and try again.
          </p>
          <Button
            className="self-start"
            loading={profile.isFetching}
            onClick={() => {
              void profile.refetch();
            }}
          >
            Try again
          </Button>
        </Window>
      </CenteredPage>
    );
  }
  return (
    <CenteredPage>
      <Spinner size="lg" label="Loading the journal…" />
    </CenteredPage>
  );
}

/**
 * `/:username`: public, for anyone with the link. A username in another
 * case is redirected to its normalized URL; one that can't exist (or isn't found) shows
 * "nobody's here ✦"; otherwise {@link ProfilePage} renders in owner or visitor mode.
 */
export function ProfileRoute() {
  const { username: raw = '' } = useParams();
  const location = useLocation();
  if (!isValidUsername(raw)) {
    return <NobodyHere />;
  }
  const username = normalizeUsername(raw);
  if (raw !== username) {
    return (
      <Navigate
        replace
        to={{ pathname: profilePath(username), search: location.search, hash: location.hash }}
      />
    );
  }
  return <ProfileLoader username={username} />;
}
