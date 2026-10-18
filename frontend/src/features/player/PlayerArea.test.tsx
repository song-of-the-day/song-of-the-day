import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { makeEntry } from '@/test/fixtures';

import { PlayerArea } from './PlayerArea';
import { makePlayerController } from './testing/fakeYouTube';

describe('PlayerArea', () => {
  it('shows only the YouTube player when a video is attached', () => {
    const entry = makeEntry({ youtube_video_id: 'dQw4w9WgXcQ' });

    render(<PlayerArea entry={entry} player={makePlayerController({ videoId: 'dQw4w9WgXcQ' })} />);

    expect(screen.getByText('Loading the video…')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: 'Preview progress' })).not.toBeInTheDocument();
  });

  it('shows the Apple preview for an iTunes song with one', () => {
    const entry = makeEntry({ youtube_video_id: null, source_id: '42' });

    render(<PlayerArea entry={entry} player={makePlayerController()} />);

    expect(screen.getByRole('button', { name: 'Play preview' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Preview progress' })).toBeInTheDocument();
  });

  it('shows nothing for a manual song without a video', () => {
    const entry = makeEntry({
      youtube_video_id: null,
      source: 'manual',
      source_id: null,
      preview_url: null,
    });

    const { container } = render(<PlayerArea entry={entry} player={makePlayerController()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
