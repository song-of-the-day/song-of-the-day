import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PublicProfile } from '@/api/types';
import { makeTheme, TIMESTAMP } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';

import { ProfileHeader } from './ProfileHeader';

function makeProfile(overrides: Partial<PublicProfile> = {}): PublicProfile {
  return {
    username: 'ada',
    display_name: 'Ada Lovelace',
    bio: '',
    theme: makeTheme(),
    created_at: TIMESTAMP,
    ...overrides,
  };
}

interface RenderOptions {
  isOwner?: boolean;
  loggedIn?: boolean;
}

function renderHeader(profile: PublicProfile, { isOwner, loggedIn }: RenderOptions = {}) {
  renderWithProviders(<ProfileHeader profile={profile} isOwner={isOwner} loggedIn={loggedIn} />);
  return within(screen.getByRole('banner'));
}

describe('ProfileHeader', () => {
  it.each(['Ada Lovelace', 'ada_l', '@ada'])(
    'shows the username under a display name (%s) that differs from it',
    (displayName) => {
      const header = renderHeader(makeProfile({ display_name: displayName }));

      expect(header.getByRole('heading', { level: 1, name: displayName })).toBeInTheDocument();
      expect(header.getByText('@ada', { selector: 'p' })).toBeInTheDocument();
    },
  );

  it.each(['ada', 'Ada', 'ADA'])(
    'shows a display name (%s) equal to the username only once',
    (displayName) => {
      const header = renderHeader(makeProfile({ display_name: displayName }));

      expect(header.getByRole('heading', { level: 1, name: displayName })).toBeInTheDocument();
      expect(header.queryByText('@ada')).not.toBeInTheDocument();
    },
  );

  it('gives the owner [Share], a plain wordmark, and no auth links or dock controls', () => {
    const header = renderHeader(makeProfile(), { isOwner: true });

    expect(header.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(header.queryByRole('link', { name: /song of the day/ })).not.toBeInTheDocument();
    expect(header.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
    expect(header.queryByRole('button', { name: 'Customize' })).not.toBeInTheDocument();
    expect(header.queryByRole('button', { name: 'Account' })).not.toBeInTheDocument();
  });

  it('gives a logged-out visitor a home-linked wordmark and the auth CTAs', () => {
    const header = renderHeader(makeProfile());

    expect(header.getByRole('link', { name: /song of the day/ })).toHaveAttribute('href', '/');
    expect(header.getByRole('link', { name: 'Log in' })).toBeInTheDocument();
    expect(header.getByRole('link', { name: 'Start your own' })).toBeInTheDocument();
    expect(header.queryByRole('button')).not.toBeInTheDocument();
  });

  it('gives a logged-in visitor only the home-linked wordmark', () => {
    const header = renderHeader(makeProfile(), { loggedIn: true });

    expect(header.getByRole('link', { name: /song of the day/ })).toHaveAttribute('href', '/');
    expect(header.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
    expect(header.queryByRole('link', { name: 'Start your own' })).not.toBeInTheDocument();
    expect(header.queryByRole('button')).not.toBeInTheDocument();
  });
});
