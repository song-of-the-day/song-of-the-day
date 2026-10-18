import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installFakeYouTube } from './testing/fakeYouTube';
import { EMBED_HOST, POLL_INTERVAL_MS, useYouTubePlayer } from './useYouTubePlayer';
import { PLAYER_STATE } from './youtube';

const VIDEO_ID = 'dQw4w9WgXcQ';

/** Renders the hook and attaches its host element, then lets the loader resolve. */
async function renderPlayer(videoId: string | null = VIDEO_ID) {
  const host = document.createElement('div');
  document.body.append(host);
  const hook = renderHook(({ id }: { id: string | null }) => useYouTubePlayer(id), {
    initialProps: { id: videoId },
  });
  act(() => {
    hook.result.current.setHost(host);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return { ...hook, host };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  for (const script of document.querySelectorAll('script')) {
    script.remove();
  }
  delete window.onYouTubeIframeAPIReady;
});

describe('useYouTubePlayer', () => {
  it('embeds the video from the privacy-enhanced host with the required player vars', async () => {
    const youtube = installFakeYouTube();
    const { host } = await renderPlayer();

    const player = youtube.latest();
    expect(player.options).toMatchObject({
      host: EMBED_HOST,
      videoId: VIDEO_ID,
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0, origin: window.location.origin },
    });
    expect(host.firstElementChild).toBe(player.element);
  });

  it('creates no player without a video', async () => {
    const youtube = installFakeYouTube();
    const { result } = await renderPlayer(null);

    expect(youtube.players).toHaveLength(0);
    expect(result.current.ready).toBe(false);
    expect(result.current.videoId).toBeNull();
  });

  it('becomes ready on onReady and reads the duration once YouTube knows it', async () => {
    const youtube = installFakeYouTube();
    const { result } = await renderPlayer();
    const player = youtube.latest();

    expect(result.current.ready).toBe(false);
    act(() => {
      player.fireReady();
    });
    expect(result.current.ready).toBe(true);
    expect(result.current.durationMs).toBe(0);

    player.duration = 212.5;
    act(() => {
      player.fireStateChange(PLAYER_STATE.BUFFERING);
    });
    expect(result.current.durationMs).toBe(212_500);
    expect(result.current.state).toBe(PLAYER_STATE.BUFFERING);

    // A later 0 (e.g. while a new video loads) keeps the known duration.
    player.duration = 0;
    act(() => {
      player.fireStateChange(PLAYER_STATE.CUED);
    });
    expect(result.current.durationMs).toBe(212_500);
  });

  it('polls the position every 250 ms only while playing', async () => {
    vi.useFakeTimers();
    const youtube = installFakeYouTube();
    const { result } = await renderPlayer();
    const player = youtube.latest();
    act(() => {
      player.fireReady();
    });
    player.getCurrentTime.mockClear();

    act(() => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS * 4);
    });
    expect(player.getCurrentTime).not.toHaveBeenCalled();

    act(() => {
      player.play();
    });
    player.getCurrentTime.mockClear();
    player.currentTime = 12.25;
    act(() => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    expect(player.getCurrentTime).toHaveBeenCalledTimes(1);
    expect(result.current.currentTimeMs).toBe(12_250);

    player.currentTime = 13;
    act(() => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    expect(result.current.currentTimeMs).toBe(13_000);

    player.currentTime = 20;
    act(() => {
      player.fireStateChange(PLAYER_STATE.PAUSED);
    });
    expect(result.current.currentTimeMs).toBe(20_000);
    player.getCurrentTime.mockClear();
    player.currentTime = 30;
    act(() => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS * 4);
    });
    expect(player.getCurrentTime).not.toHaveBeenCalled();
    expect(result.current.currentTimeMs).toBe(20_000);
  });

  it('seeks and reads the exact time only once ready', async () => {
    const youtube = installFakeYouTube();
    const { result } = await renderPlayer();
    const player = youtube.latest();

    act(() => {
      result.current.seekTo(5000);
    });
    expect(player.seekTo).not.toHaveBeenCalled();
    expect(result.current.getCurrentTimeMs()).toBe(0);

    act(() => {
      player.fireReady();
    });
    act(() => {
      result.current.seekTo(83_000);
    });

    expect(player.seekTo).toHaveBeenCalledWith(83, true);
    expect(result.current.currentTimeMs).toBe(83_000);
    player.currentTime = 84.4;
    expect(result.current.getCurrentTimeMs()).toBe(84_400);
  });

  it.each([2, 5, 100, 101, 150])('treats error %i as an unplayable video', async (code) => {
    const youtube = installFakeYouTube();
    const { result } = await renderPlayer();
    const player = youtube.latest();
    act(() => {
      player.fireReady();
    });

    act(() => {
      player.fireError(code);
    });

    expect(result.current.error).toBe('unplayable');
    expect(result.current.ready).toBe(false);
    act(() => {
      result.current.seekTo(1000);
    });
    expect(player.seekTo).not.toHaveBeenCalled();
  });

  it('stays unusable when onReady arrives after an error', async () => {
    const youtube = installFakeYouTube();
    const { result } = await renderPlayer();
    const player = youtube.latest();

    act(() => {
      player.fireError(150);
      player.fireReady();
    });

    expect(result.current.ready).toBe(false);
    expect(result.current.error).toBe('unplayable');
  });

  it('reports blocked autoplay until the video plays', async () => {
    const youtube = installFakeYouTube();
    const { result } = await renderPlayer();
    const player = youtube.latest();
    act(() => {
      player.fireReady();
    });

    act(() => {
      player.fireAutoplayBlocked();
    });
    expect(result.current.autoplayBlocked).toBe(true);

    act(() => {
      player.fireStateChange(PLAYER_STATE.PAUSED);
    });
    expect(result.current.autoplayBlocked).toBe(true);

    act(() => {
      player.play();
    });
    expect(result.current.autoplayBlocked).toBe(false);
  });

  it('destroys the player on unmount and when the video changes', async () => {
    const youtube = installFakeYouTube();
    const { result, rerender, unmount, host } = await renderPlayer();
    const first = youtube.latest();
    act(() => {
      first.fireReady();
    });

    rerender({ id: 'abcdefghijk' });
    await act(async () => {
      await Promise.resolve();
    });

    expect(first.destroyed).toBe(true);
    const second = youtube.latest();
    expect(second).not.toBe(first);
    expect(second.options.videoId).toBe('abcdefghijk');
    expect(result.current.ready).toBe(false);
    // Events from the old player no longer count.
    act(() => {
      first.fireReady();
    });
    expect(result.current.ready).toBe(false);

    unmount();

    expect(second.destroyed).toBe(true);
    expect(host.childElementCount).toBe(0);
  });

  it('reports a load failure and retries', async () => {
    const { result } = await renderPlayer();
    const script = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');

    await act(async () => {
      script?.dispatchEvent(new Event('error'));
      await Promise.resolve();
    });
    expect(result.current.error).toBe('load_failed');

    const youtube = installFakeYouTube();
    await act(async () => {
      result.current.retry();
      await Promise.resolve();
    });

    expect(result.current.error).toBeNull();
    expect(youtube.players).toHaveLength(1);
  });
});
