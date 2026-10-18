/**
 * Where to go after logging in: back to the page that required it, or the user's profile.
 */
import type { Location } from 'react-router';

/**
 * The path of a profile page.
 *
 * @param username - The normalized username.
 * @returns `/<username>`.
 */
export function profilePath(username: string): string {
  return `/${encodeURIComponent(username)}`;
}

/** Pages a user is never sent back to after logging in. */
const AUTH_PATHS = new Set(['/login', '/signup', '/forgot-password', '/reset-password']);

/** The router location state set when a page redirects to `/login`. */
export interface FromState {
  from: Pick<Location, 'pathname' | 'search' | 'hash'>;
}

/**
 * Builds the location state that remembers the page to come back to.
 *
 * @param location - The page that required logging in.
 * @returns State for `<Navigate state>`.
 */
export function fromState(location: Pick<Location, 'pathname' | 'search' | 'hash'>): FromState {
  return { from: { pathname: location.pathname, search: location.search, hash: location.hash } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSafeLocalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}

/**
 * Resolves the destination after logging in from router location state. Anything that is not a
 * same-app path (or is an auth page) falls back to the user's profile.
 *
 * @param state - `location.state` of the login or signup page (untrusted shape).
 * @param username - The logged-in user's username, for the fallback.
 * @returns A path with its search and hash.
 */
export function redirectTarget(state: unknown, username: string): string {
  const home = profilePath(username);
  if (!isRecord(state) || !isRecord(state.from)) {
    return home;
  }
  const { pathname, search, hash } = state.from;
  if (typeof pathname !== 'string' || !isSafeLocalPath(pathname) || AUTH_PATHS.has(pathname)) {
    return home;
  }
  const query = typeof search === 'string' && search.startsWith('?') ? search : '';
  const fragment = typeof hash === 'string' && hash.startsWith('#') ? hash : '';
  return `${pathname}${query}${fragment}`;
}
