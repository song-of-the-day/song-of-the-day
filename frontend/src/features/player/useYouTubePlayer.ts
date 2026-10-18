/**
 * A React controller for one embedded YouTube player.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { claimPlayback, releasePlayback, type Playable } from './nowPlaying';
import {
  loadYouTubeIframeApi,
  PLAYER_STATE,
  type PlayerState,
  type YouTubePlayer,
} from './youtube';

/** Players are embedded from the privacy-enhanced host. */
export const EMBED_HOST = 'https://www.youtube-nocookie.com';
/** How often the playback position is read while the video plays. */
export const POLL_INTERVAL_MS = 250;

/**
 * Why there is no usable player: the video can't be embedded or played (`onError` codes 2, 5,
 * 100, 101 and 150), or the IFrame API script didn't load.
 */
export type YouTubePlayerError = 'unplayable' | 'load_failed';

export interface YouTubePlayerController {
  /** Callback ref for the element that hosts the player's iframe. */
  setHost: (element: HTMLDivElement | null) => void;
  /** The video being played, or `null` when there is none. */
  videoId: string | null;
  /** The player fired `onReady` and has not failed: it can report its time and seek. */
  ready: boolean;
  /** The last `onStateChange` value (a `PLAYER_STATE`). */
  state: PlayerState;
  /** The video length; 0 until the metadata has loaded. */
  durationMs: number;
  /** The playback position, refreshed every {@link POLL_INTERVAL_MS} while playing. */
  currentTimeMs: number;
  /** Reads the exact playback position now (0 without a ready player). */
  getCurrentTimeMs: () => number;
  /** Jumps to a position (no-op without a ready player). */
  seekTo: (ms: number) => void;
  /** The browser blocked playback started by a script; the user has to press play. */
  autoplayBlocked: boolean;
  error: YouTubePlayerError | null;
  /** Creates the player again (e.g. after `load_failed`). */
  retry: () => void;
}

interface Status {
  /** The player session these values belong to (video id and attempt). */
  session: string;
  ready: boolean;
  state: PlayerState;
  durationMs: number;
  currentTimeMs: number;
  autoplayBlocked: boolean;
  error: YouTubePlayerError | null;
}

type StatusPatch = Partial<Omit<Status, 'session'>>;

function initialStatus(session: string): Status {
  return {
    session,
    ready: false,
    state: PLAYER_STATE.UNSTARTED,
    durationMs: 0,
    currentTimeMs: 0,
    autoplayBlocked: false,
    error: null,
  };
}

export interface YouTubePlayerOptions {
  /**
   * Start playing once the player is ready (the viewer's auto-play preference). If the browser
   * blocks it, nothing is shown: the player just stays paused.
   */
  autoPlay?: boolean;
}

function secondsToMs(seconds: number): number {
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : 0;
}

/**
 * Embeds a YouTube video in the element given to `setHost` and tracks its state.
 *
 * The IFrame API is loaded on demand. The player uses the youtube-nocookie host with
 * `playsinline=1`, `rel=0` and `origin` set to this page. Its duration is re-read on every state
 * change (YouTube reports 0 until the metadata loads), and its position is polled every 250 ms
 * only while it plays. The player is destroyed when the video changes or the host unmounts.
 * While it plays, it holds the app's single "now playing" slot (`nowPlaying.ts`).
 *
 * @param videoId - The 11-character video id, or `null` for no player.
 * @param options - Auto-play.
 * @returns The player's state and controls.
 */
export function useYouTubePlayer(
  videoId: string | null,
  { autoPlay = false }: YouTubePlayerOptions = {},
): YouTubePlayerController {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const session = `${videoId ?? ''}#${String(attempt)}`;
  const [status, setStatus] = useState<Status>(() => initialStatus(session));
  const playerRef = useRef<YouTubePlayer | null>(null);
  // Read when the player becomes ready; auto-play applies to the first video only.
  const autoPlayRef = useRef(autoPlay);
  // Set while auto-play is pending: a blocked auto-play stays silent, but a blocked seek asks
  // the user to press play.
  const autoPlayingRef = useRef(false);
  // One stable handle for the shared now-playing controller.
  const [playable] = useState<Playable>(() => ({
    pause: () => {
      playerRef.current?.pauseVideo();
    },
  }));
  const current = status.session === session ? status : initialStatus(session);

  const update = useCallback(
    (patch: StatusPatch | ((previous: Status) => StatusPatch)) => {
      setStatus((previous) => {
        const base = previous.session === session ? previous : initialStatus(session);
        return { ...base, ...(typeof patch === 'function' ? patch(base) : patch) };
      });
    },
    [session],
  );

  useEffect(() => {
    if (host === null || videoId === null) {
      return undefined;
    }
    let active = true;
    let failed = false;
    let player: YouTubePlayer | null = null;
    // YouTube replaces this element with its iframe; React never renders into it.
    const mount = document.createElement('div');
    host.replaceChildren(mount);

    loadYouTubeIframeApi().then(
      (api) => {
        if (!active) {
          return;
        }
        player = new api.Player(mount, {
          host: EMBED_HOST,
          videoId,
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, rel: 0, origin: window.location.origin },
          events: {
            onReady: ({ target }) => {
              if (!active || failed) {
                return;
              }
              playerRef.current = target;
              update({
                ready: true,
                durationMs: secondsToMs(target.getDuration()),
                currentTimeMs: secondsToMs(target.getCurrentTime()),
              });
              if (autoPlayRef.current) {
                autoPlayRef.current = false;
                autoPlayingRef.current = true;
                target.playVideo();
              }
            },
            onStateChange: ({ target, data }) => {
              if (!active) {
                return;
              }
              if (data === PLAYER_STATE.PLAYING) {
                autoPlayingRef.current = false;
                claimPlayback(playable);
              } else if (data === PLAYER_STATE.PAUSED || data === PLAYER_STATE.ENDED) {
                releasePlayback(playable);
              }
              update((previous) => ({
                state: data,
                durationMs: secondsToMs(target.getDuration()) || previous.durationMs,
                currentTimeMs: secondsToMs(target.getCurrentTime()),
                autoplayBlocked: data === PLAYER_STATE.PLAYING ? false : previous.autoplayBlocked,
              }));
            },
            onError: () => {
              if (!active) {
                return;
              }
              failed = true;
              playerRef.current = null;
              update({ error: 'unplayable', ready: false });
            },
            onAutoplayBlocked: () => {
              if (active && !autoPlayingRef.current) {
                update({ autoplayBlocked: true });
              }
              autoPlayingRef.current = false;
            },
          },
        });
      },
      () => {
        if (active) {
          update({ error: 'load_failed' });
        }
      },
    );

    return () => {
      active = false;
      playerRef.current = null;
      releasePlayback(playable);
      player?.destroy();
      host.replaceChildren();
    };
  }, [host, videoId, update, playable]);

  const playing = current.ready && current.state === PLAYER_STATE.PLAYING;
  useEffect(() => {
    if (!playing) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (player !== null) {
        update({ currentTimeMs: secondsToMs(player.getCurrentTime()) });
      }
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [playing, update]);

  const getCurrentTimeMs = useCallback(() => {
    const player = playerRef.current;
    return player === null ? 0 : secondsToMs(player.getCurrentTime());
  }, []);

  const seekTo = useCallback(
    (ms: number) => {
      const player = playerRef.current;
      if (player === null) {
        return;
      }
      autoPlayingRef.current = false;
      player.seekTo(ms / 1000, true);
      update({ currentTimeMs: Math.max(0, ms) });
    },
    [update],
  );

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  return {
    setHost,
    videoId,
    ready: current.ready && current.error === null,
    state: current.state,
    durationMs: current.durationMs,
    currentTimeMs: current.currentTimeMs,
    getCurrentTimeMs,
    seekTo,
    autoplayBlocked: current.autoplayBlocked,
    error: current.error,
    retry,
  };
}
