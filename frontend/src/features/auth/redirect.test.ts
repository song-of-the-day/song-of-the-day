import { describe, expect, it } from 'vitest';

import { fromState, profilePath, redirectTarget } from './redirect';

const HOME = '/ada';

function target(state: unknown): string {
  return redirectTarget(state, 'ada');
}

describe('fromState', () => {
  it('keeps only the path, query and fragment of the location', () => {
    const location = { pathname: '/profile', search: '?entry=4', hash: '#notes', key: 'x' };

    expect(fromState(location)).toEqual({
      from: { pathname: '/profile', search: '?entry=4', hash: '#notes' },
    });
  });
});

describe('profilePath', () => {
  it('builds /<username>', () => {
    expect(profilePath('ada')).toBe('/ada');
  });
});

describe('redirectTarget', () => {
  it('returns to the remembered page', () => {
    expect(target(fromState({ pathname: '/profile', search: '?view=calendar', hash: '' }))).toBe(
      '/profile?view=calendar',
    );
    expect(target({ from: { pathname: '/profile', search: '', hash: '#top' } })).toBe(
      '/profile#top',
    );
  });

  it("falls back to the user's profile without usable state", () => {
    expect(target(undefined)).toBe(HOME);
    expect(target(null)).toBe(HOME);
    expect(target({})).toBe(HOME);
    expect(target({ from: '/profile' })).toBe(HOME);
    expect(target({ from: { pathname: 42 } })).toBe(HOME);
  });

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example', 'profile'])(
    'never leaves the app for "%s"',
    (pathname) => {
      expect(target({ from: { pathname, search: '', hash: '' } })).toBe(HOME);
    },
  );

  it.each(['/login', '/signup', '/forgot-password', '/reset-password'])(
    'never returns to the auth page %s',
    (pathname) => {
      expect(target({ from: { pathname } })).toBe(HOME);
    },
  );

  it('ignores a malformed query or fragment', () => {
    expect(target({ from: { pathname: '/profile', search: 'x=1', hash: 5 } })).toBe('/profile');
  });
});
