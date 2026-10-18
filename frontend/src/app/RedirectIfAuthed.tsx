import { Navigate, Outlet, useLocation } from 'react-router';

import { useMe } from '@/api/hooks/auth';
import { redirectTarget } from '@/features/auth/redirect';

import { SessionLoading } from './SessionScreens';

/**
 * Wraps the logged-out pages (`/login`, `/signup`, `/forgot-password`): a logged-in user goes to
 * the page they came for, or their profile. If the session can't be loaded, the page still shows
 * (its form reports any connection problem itself).
 */
export function RedirectIfAuthed() {
  const location = useLocation();
  const me = useMe();

  if (me.data !== undefined && me.data !== null) {
    return <Navigate to={redirectTarget(location.state, me.data.username)} replace />;
  }
  if (me.data === undefined && !me.isError) {
    return <SessionLoading />;
  }
  return <Outlet />;
}
