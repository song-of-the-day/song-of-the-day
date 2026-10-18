import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { makeEntry } from '@/test/fixtures';

import { ListenOnRow } from './ListenOnRow';

function row(overrides: Parameters<typeof makeEntry>[0] = {}) {
  render(<ListenOnRow entry={makeEntry(overrides)} />);
  return screen.getByRole('list');
}

describe('ListenOnRow', () => {
  it('shows the label and one named, outbound pill per platform', () => {
    const list = row({ source_id: null, youtube_video_id: null, external_url: null });

    expect(screen.getByText('Listen on', { selector: 'p' })).toBeInTheDocument();
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(7);
    const spotify = within(list).getByRole('link', {
      name: 'Listen on Spotify (opens in a new tab)',
    });
    expect(spotify).toHaveAttribute('href', 'https://open.spotify.com/search/Jamie%20xx%20Gosh');
    expect(spotify).toHaveAttribute('target', '_blank');
    expect(spotify).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(list).getByRole('link', { name: /Apple Music/ })).toHaveAttribute(
      'href',
      'https://music.apple.com/search?term=Jamie%20xx%20Gosh',
    );
    expect(within(list).getByRole('link', { name: /YouTube Music/ })).toHaveAttribute(
      'href',
      'https://music.youtube.com/search?q=Jamie%20xx%20Gosh',
    );
    expect(within(list).getByRole('link', { name: /Amazon Music/ })).toHaveAttribute(
      'href',
      'https://music.amazon.com/search/Jamie%20xx%20Gosh',
    );
    expect(within(list).getByRole('link', { name: /Tidal/ })).toHaveAttribute(
      'href',
      'https://listen.tidal.com/search?q=Jamie%20xx%20Gosh',
    );
    expect(within(list).getByRole('link', { name: /Deezer/ })).toHaveAttribute(
      'href',
      'https://www.deezer.com/search/Jamie%20xx%20Gosh',
    );
    expect(within(list).getByRole('link', { name: /SoundCloud/ })).toHaveAttribute(
      'href',
      'https://soundcloud.com/search/sounds?q=Jamie%20xx%20Gosh',
    );
  });

  it('renders brand marks monochrome, with lucide fallbacks where needed', () => {
    const list = row({ source_id: null, youtube_video_id: null, external_url: null });

    const spotify = within(list).getByRole('link', { name: /Spotify/ });
    const mark = spotify.querySelector('svg');
    expect(mark).toHaveAttribute('viewBox', '0 0 24 24');
    expect(mark).toHaveAttribute('fill', 'currentColor');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark?.querySelector('path')).not.toBeNull();
    // Amazon Music is not in the installed icon set, so it falls back to lucide's Music.
    expect(
      within(list)
        .getByRole('link', { name: /Amazon Music/ })
        .querySelector('.lucide-music'),
    ).not.toBeNull();
  });

  it('links the platform the external link belongs to', () => {
    const list = row({ external_url: 'https://open.spotify.com/track/abc' });

    expect(within(list).getByRole('link', { name: /Spotify/ })).toHaveAttribute(
      'href',
      'https://open.spotify.com/track/abc',
    );
    expect(within(list).getAllByRole('listitem')).toHaveLength(7);
  });

  it('adds a Bandcamp pill for a Bandcamp link', () => {
    const list = row({ external_url: 'https://artist.bandcamp.com/album/colours' });

    const bandcamp = within(list).getByRole('link', {
      name: 'Listen on Bandcamp (opens in a new tab)',
    });
    expect(bandcamp).toHaveAttribute('href', 'https://artist.bandcamp.com/album/colours');
    expect(bandcamp.querySelector('svg path')).not.toBeNull();
    expect(within(list).getAllByRole('listitem')).toHaveLength(8);
  });

  it('names an unrelated host by its hostname with lucide Link', () => {
    const list = row({ external_url: 'https://itunes.apple.com/us/album/x/1' });

    const extra = within(list).getByRole('link', {
      name: 'Listen on itunes.apple.com (opens in a new tab)',
    });
    expect(extra).toHaveAttribute('href', 'https://itunes.apple.com/us/album/x/1');
    expect(extra.querySelector('.lucide-link')).not.toBeNull();
  });
});
