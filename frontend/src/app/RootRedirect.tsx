import { Navigate, useLocation } from 'react-router';

import { useMe } from '@/api/hooks/auth';
import { fromState, profilePath } from '@/features/auth/redirect';

import { SessionError, SessionLoading } from './SessionScreens';

/**
 * `/` and `/profile`: the logged-in user's profile (`/<username>`, keeping the search params and
 * hash, e.g. `/profile?entry=4`), otherwise the login page, which comes back here after logging
 * in.
 */
export function RootRedirect() {
  const location = useLocation();
  const me = useMe();

  if (me.data === null) {
    const remember = location.pathname !== '/' || location.search !== '' || location.hash !== '';
    return <Navigate to="/login" replace state={remember ? fromState(location) : undefined} />;
  }
  if (me.data !== undefined) {
    return (
      <Navigate
        to={{
          pathname: profilePath(me.data.username),
          search: location.search,
          hash: location.hash,
        }}
        replace
      />
    );
  }
  if (me.isError) {
    return (
      <SessionError
        retrying={me.isFetching}
        onRetry={() => {
          void me.refetch();
        }}
      />
    );
  }
  return <SessionLoading />;
}
