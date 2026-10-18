import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { installFakeYouTube, makePlayerController } from './testing/fakeYouTube';
import { useYouTubePlayer } from './useYouTubePlayer';
import {
  AUTOPLAY_BLOCKED_MESSAGE,
  LOAD_FAILED_MESSAGE,
  UNPLAYABLE_MESSAGE,
  YouTubePlayer,
} from './YouTubePlayer';

const VIDEO_ID = 'dQw4w9WgXcQ';

function Harness({ videoId }: { videoId: string }) {
  return <YouTubePlayer videoId={videoId} player={useYouTubePlayer(videoId)} />;
}

async function renderHarness() {
  const view = render(<Harness videoId={VIDEO_ID} />);
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

afterEach(() => {
  for (const script of document.querySelectorAll('script')) {
    script.remove();
  }
  delete window.onYouTubeIframeAPIReady;
});

describe('YouTubePlayer', () => {
  it('shows a spinner in a 16:9 box until the player is ready', async () => {
    const youtube = installFakeYouTube();
    const { container } = await renderHarness();

    expect(screen.getByText('Loading the video…')).toBeInTheDocument();
    const box = container.querySelector('.aspect-video');
    expect(box).toHaveClass('w-full', 'min-h-[200px]', 'min-w-[200px]');
    expect(box).toContainElement(youtube.latest().element);

    act(() => {
      youtube.latest().fireReady();
    });

    expect(screen.queryByText('Loading the video…')).not.toBeInTheDocument();
  });

  it('offers the video on YouTube when it cannot be played here', async () => {
    const youtube = installFakeYouTube();
    await renderHarness();

    act(() => {
      youtube.latest().fireError(150);
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(UNPLAYABLE_MESSAGE);
    expect(screen.getByRole('link', { name: /Watch on YouTube/ })).toHaveAttribute(
      'href',
      `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('retries when the player script fails to load', async () => {
    await renderHarness();
    await act(async () => {
      document
        .querySelector('script[src="https://www.youtube.com/iframe_api"]')
        ?.dispatchEvent(new Event('error'));
      await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toHaveTextContent(LOAD_FAILED_MESSAGE);

    const youtube = installFakeYouTube();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(youtube.players).toHaveLength(1);
  });

  it('asks the user to press play when the browser blocks playback', () => {
    render(
      <YouTubePlayer
        videoId={VIDEO_ID}
        player={makePlayerController({ videoId: VIDEO_ID, ready: true, autoplayBlocked: true })}
      />,
    );

    expect(screen.getByText(AUTOPLAY_BLOCKED_MESSAGE)).toHaveAttribute('role', 'status');
  });

  it('keeps an empty live region while playback is allowed', () => {
    render(
      <YouTubePlayer
        videoId={VIDEO_ID}
        player={makePlayerController({ videoId: VIDEO_ID, ready: true })}
      />,
    );

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
