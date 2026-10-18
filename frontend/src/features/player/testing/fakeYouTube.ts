/**
 * Test doubles for the YouTube IFrame API (`window.YT`) and for a player controller.
 *
 * ```ts
 * const youtube = installFakeYouTube();
 * // ...render something that embeds a video...
 * act(() => { youtube.latest().fireReady(); });
 * ```
 */
import { vi } from 'vitest';

import type { YouTubePlayerController } from '../useYouTubePlayer';
import {
  PLAYER_STATE,
  type PlayerState,
  type YouTubeIframeApi,
  type YouTubePlayer,
  type YouTubePlayerOptions,
} from '../youtube';

/** A scriptable `YT.Player`: tests set its time and duration and fire its events. */
export class FakePlayer implements YouTubePlayer {
  readonly element: HTMLElement;
  readonly options: YouTubePlayerOptions;
  /** Playback position in seconds. */
  currentTime = 0;
  /** Video length in seconds (0 = metadata not loaded yet). */
  duration = 0;
  destroyed = false;
  readonly seekTo = vi.fn((seconds: number) => {
    this.currentTime = seconds;
  });
  readonly getCurrentTime = vi.fn(() => this.currentTime);
  readonly playVideo = vi.fn();
  readonly pauseVideo = vi.fn();

  constructor(element: HTMLElement, options: YouTubePlayerOptions) {
    this.element = element;
    this.options = options;
  }

  getDuration(): number {
    return this.duration;
  }

  destroy(): void {
    this.destroyed = true;
  }

  fireReady(): void {
    this.options.events?.onReady?.({ target: this, data: undefined });
  }

  fireStateChange(state: PlayerState): void {
    this.options.events?.onStateChange?.({ target: this, data: state });
  }

  /** Fires `onStateChange(PLAYING)`. */
  play(): void {
    this.fireStateChange(PLAYER_STATE.PLAYING);
  }

  fireError(code: number): void {
    this.options.events?.onError?.({ target: this, data: code });
  }

  fireAutoplayBlocked(): void {
    this.options.events?.onAutoplayBlocked?.({ target: this, data: undefined });
  }
}

export interface FakeYouTube {
  /** Every player created since installation, oldest first. */
  readonly players: FakePlayer[];
  /** The most recently created player. */
  latest(): FakePlayer;
}

/**
 * Installs a fully loaded fake `window.YT` (removed after the test by Vitest's `unstubGlobals`).
 *
 * @returns Access to the players the code under test creates.
 */
export function installFakeYouTube(): FakeYouTube {
  const players: FakePlayer[] = [];
  class TrackedPlayer extends FakePlayer {
    constructor(element: HTMLElement, options: YouTubePlayerOptions) {
      super(element, options);
      players.push(this);
    }
  }
  const api: YouTubeIframeApi = { loaded: 1, Player: TrackedPlayer };
  vi.stubGlobal('YT', api);
  return {
    players,
    latest() {
      const player = players.at(-1);
      if (player === undefined) {
        throw new Error('No YouTube player was created');
      }
      return player;
    },
  };
}

/**
 * Builds a player controller for components that take one as a prop.
 *
 * @param overrides - The state to report (default: no video, not ready).
 * @returns A controller whose `seekTo`, `getCurrentTimeMs` and `retry` are mocks.
 */
export function makePlayerController(
  overrides: Partial<YouTubePlayerController> = {},
): YouTubePlayerController {
  return {
    setHost: vi.fn(),
    videoId: null,
    ready: false,
    state: PLAYER_STATE.UNSTARTED,
    durationMs: 0,
    currentTimeMs: 0,
    getCurrentTimeMs: vi.fn(() => overrides.currentTimeMs ?? 0),
    seekTo: vi.fn(),
    autoplayBlocked: false,
    error: null,
    retry: vi.fn(),
    ...overrides,
  };
}
