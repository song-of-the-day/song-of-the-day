import { afterEach, describe, expect, it, vi } from 'vitest';

import { claimPlayback, nowPlaying, releasePlayback, type Playable } from './nowPlaying';

function playable() {
  const pause = vi.fn<() => void>();
  const handle: Playable = { pause };
  return Object.assign(handle, { pause });
}

describe('now playing', () => {
  afterEach(() => {
    const playing = nowPlaying();
    if (playing !== null) releasePlayback(playing);
  });

  it('pauses the previous player when another one starts', () => {
    const first = playable();
    const second = playable();

    claimPlayback(first);
    claimPlayback(second);

    expect(first.pause).toHaveBeenCalledTimes(1);
    expect(second.pause).not.toHaveBeenCalled();
    expect(nowPlaying()).toBe(second);
  });

  it('does not pause a player that claims again', () => {
    const only = playable();

    claimPlayback(only);
    claimPlayback(only);

    expect(only.pause).not.toHaveBeenCalled();
  });

  it('forgets a released player, but only the one playing', () => {
    const first = playable();
    const second = playable();
    claimPlayback(first);

    releasePlayback(second);
    expect(nowPlaying()).toBe(first);

    releasePlayback(first);
    expect(nowPlaying()).toBeNull();
    claimPlayback(second);
    expect(first.pause).not.toHaveBeenCalled();
  });
});
