import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PreviewPlayer } from './PreviewPlayer';

const PREVIEW_URL = 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/preview.m4a';

/** jsdom's media element reports duration NaN and never advances; fake them per test. */
function setPlayback(audio: HTMLAudioElement, currentTime: number, duration: number) {
  Object.defineProperty(audio, 'currentTime', { configurable: true, value: currentTime });
  Object.defineProperty(audio, 'duration', { configurable: true, value: duration });
}

function renderPreview() {
  const view = render(<PreviewPlayer previewUrl={PREVIEW_URL} />);
  const audio = view.container.querySelector('audio');
  if (audio === null) {
    throw new Error('no <audio>');
  }
  return { ...view, audio };
}

describe('PreviewPlayer', () => {
  it('shows only the play control and an empty progress display, loading nothing', () => {
    const { audio } = renderPreview();

    expect(screen.getByRole('button', { name: 'Play preview' })).toBeInTheDocument();
    expect(screen.queryByText(/courtesy|not synced|Listen on/)).not.toBeInTheDocument();
    expect(audio).toHaveAttribute('preload', 'none');
    expect(audio).toHaveAttribute('src', PREVIEW_URL);
    const bar = screen.getByRole('progressbar', { name: 'Preview progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(bar).toHaveAttribute('aria-valuetext', '0:00 of 0:00');
  });

  it('plays and pauses the preview', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause');
    const { audio } = renderPreview();

    await userEvent.click(screen.getByRole('button', { name: 'Play preview' }));
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.play(audio);

    // jsdom's media element never leaves the paused state on its own.
    Object.defineProperty(audio, 'paused', { configurable: true, value: false });
    await userEvent.click(screen.getByRole('button', { name: 'Pause preview' }));
    expect(pause).toHaveBeenCalledTimes(1);
    fireEvent.pause(audio);

    expect(screen.getByRole('button', { name: 'Play preview' })).toBeInTheDocument();
  });

  it('tracks the preview progress as it plays', () => {
    const { audio } = renderPreview();
    setPlayback(audio, 12, 30);

    fireEvent.durationChange(audio);
    fireEvent.timeUpdate(audio);

    const bar = screen.getByRole('progressbar', { name: 'Preview progress' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '30');
    expect(bar).toHaveAttribute('aria-valuenow', '12');
    expect(bar).toHaveAttribute('aria-valuetext', '0:12 of 0:30');
    expect(screen.getByText('0:12')).toBeInTheDocument();
  });

  it('shows the play button again when the preview ends', () => {
    const { audio } = renderPreview();
    fireEvent.play(audio);

    fireEvent.ended(audio);

    expect(screen.getByRole('button', { name: 'Play preview' })).toBeInTheDocument();
  });

  it('stays paused when the browser refuses to play', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('NotAllowedError'));
    renderPreview();

    await userEvent.click(screen.getByRole('button', { name: 'Play preview' }));

    expect(screen.getByRole('button', { name: 'Play preview' })).toBeInTheDocument();
  });

  it('hides the control when the preview fails', () => {
    const { audio } = renderPreview();

    fireEvent.error(audio);

    expect(screen.queryByRole('button', { name: 'Play preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
